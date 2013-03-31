var config = require('./config');

var http = require("http");
var https = require('https');
var fs = require('fs');
var YUI = require('yui/debug').YUI;
var PATH = require('path');
var URL = require('url');
var NodeCache = require( "node-cache" );
var chokidar = require('chokidar');

var MIME_PLAIN = "text/plain";
var MIME_HTML = "text/html";
var MIME_JAVASCRIPT = "application/javascript";
var MIME_ICON = "image/x-icon";

var MIME_TYPES = {
    ".html" : MIME_HTML,
    ".htm"  : MIME_HTML,
    ".js"   : MIME_JAVASCRIPT,
    ".txt"  : MIME_PLAIN,
    ".ico"  : MIME_ICON
};

var HTTP_PORT = 8888;
var HTTPS_PORT = 8889;
var HTTPS_CONFIG = {
  key: fs.readFileSync('.ssl/key.pem'),
  cert: fs.readFileSync('.ssl/cert.pem')
};

var DEFAULT_MAX_CACHED_PAGES = 5;
var PAGE_CACHE_CONFIG = {
    stdTTL: config.cache.ttl || 100,
    checkperiod: config.cache.check || 120
};


YUI().use("base", "yui-base", "datatype-date", "cache", function(Y) {

    /*------------------------------
    -- SHORTCUTS
    --------------------------------*/
    var substitute = Y.Lang.sub;

    /**
     * [log description]
     * @param  {[type]} msg  [description]
     * @param  {[type]} type [description]
     * @return {[type]}      [description]
     */
    var log = function(msg, type, data, module) {
        if (type && !Y.Lang.isString(type)) {
            data = type;
            type = null;
        }
        module = module || "server.js";
        type =  type  || "info";
        msg = !data ? msg : substitute(msg, data);

        if (!config.debug && (type === "error" || type === "warn") || config.debug) {
            console.log(type + " (" + module + "): " + now() + " : " + msg);
        }
    };

    /**
     * [now description]
     * @return {[type]} [description]
     */
    var now = function() {
        return Y.Date.format(new Date());
    };

    /**
     * [getRequestFilePath description]
     * @param  {[type]} request [description]
     * @return {[type]}         [description]
     */
    var getRequestFilePath = function(request) {
        var url = URL.parse(request.url, true);
        if (!url.pathname) {
            return buildPath(config["default"] || "default.html");
        } else {
            return buildPath(url.pathname);
        }
    };

    /**
     * [buildPath description]
     * @param  {[type]} part [description]
     * @return {[type]}      [description]
     */
    var buildPath = function(part) {
        return PATH.normalize(PATH.join(config.root, part));
    };

    /**
     * [writeDebuggingContent description]
     * @param  {[type]} response [description]
     * @return {[type]}          [description]
     */
    var writeDebuggingContent = function(request, response) {
        // Extra dump information
        if (config.debug && config["dump-to-response"]) {
            var write = function(text) {
                response.write(text);
            };
            response.write("<hr><b>Configuration:</b><br/>");
            response.write(dump(config, MIME_HTML, write));
            response.write("<br/><br/>");
            response.write("<b>Request:</b><br/>");
            response.write(dump(request, MIME_HTML, write));
        }
    };

    /**
     * [getMimeType description]
     * @param  {[type]} path [description]
     * @return {[type]}      [description]
     */
    var getMimeType = function(path) {
        var ext = PATH.extname(path);
        return MIME_TYPES[ext] || MIME_PLAIN;
    };

    /**
     * [writeFile description]
     * @param  {[type]} filePath [description]
     * @param  {[type]} response [description]
     * @param  {[type]} args     [description]
     * @return {[type]}          [description]
     */
    var writeFile = function(filePath, request, response, args) {
        log("Attempting to write file: {path}", { path : filePath });
        pageCache.get(filePath, function(err, cache) {
            if (err) {
                log("Cache error: {error}", { error : err });
                log("500: cache get");
                writeFile(buildPath("500.html"), request, response, { path : filePath, error : err, terminate: true });
                return;
            }

            var content = cache[filePath];
            if (content) {
                var out = !args ? content : substitute(content, args);
                log("Content: {content}", { content : out });
                writeContent(request, response, content, getMimeType(filePath), 200);
                return;
            } else {
                log("Attempting to read the file from disk.");
                fs.readFile(filePath, function(error, content) {
                    if (error) {
                        log("File read error: {error}", { error : err });
                        log("404: first read");
                        writeFile(buildPath("404.html"), request, response, { path : filePath, error : error, terminate: true });
                        return;
                    }

                    if (content) {
                        var out = !args ? content : substitute(content, args);
                        log("Content: {content}", { content : out });
                        writeContent(request, response, out, getMimeType(filePath), 200);
                        pageCache.set(filePath, content, function(err, success) {
                            if (err) {
                                log(substitute("Cache error: {error}", { error : err }));
                            }
                        });
                    } else {
                        log("404: no content on first read.");
                        writeFile(buildPath("404.html"), request, response, { path : filePath, error : error, terminate: true });
                    }
                });
            }
        });

    };

    /**
     * [writeContent description]
     * @param  {[type]} response [description]
     * @param  {[type]} content  [description]
     * @param  {[type]} type     [description]
     * @param  {[type]} status   [description]
     * @return {[type]}          [description]
     */
    var writeContent = function(request, response, content, type, status) {
        content = content || "No Content";
        response.writeHead(status, { "Content-Type": type, 'Transfer-Encoding': 'chunked'});
        response.write(content);
        if (type === MIME_HTML) {
            writeDebuggingContent(request, response);
        }
        response.end();
        log("Request Complete.");
    };

    /**
     * [onRequest description]
     * @param  {[type]} request  [description]
     * @param  {[type]} response [description]
     * @return {[type]}          [description]
     */
    var onRequest = function(request, response) {
        log("Processing request.");
        var filePath = getRequestFilePath(request);
        log("Requested file: {path}.", { path: filePath });
        writeFile(filePath, request, response);
    };

    /**
     * [dump description]
     * @param  {[type]} obj [description]
     * @return {[type]}     [description]
     */
    var dump = function (obj, type, write) {
        'use strict';

        type = type || config["dump-type"] || MIME_PLAIN;

        var results = "<style>.tree { margin-left: 20px }</style>\n";
        if (!write) {
            write = function(text) {
                results += text;
            };
        }
        if (type === MIME_HTML) {
            var depth = 0;
            var renderJSON = function(obj) {
                if (depth > 4) { return write("..."); }
                for (var key in obj) {
                    if (typeof obj[key] === 'function') {
                        if (config["dump-functions"]) {
                            write("<div class='tree'>\n" + key + " : function() { },\n</div>\n");
                        }
                    } else if (typeof obj[key] === 'object') {
                        depth++;
                        write("<div class='tree'>\n" + key + " : {\n");
                        renderJSON(obj[key]);
                        write("\n}\n</div>");
                        depth--;
                    } else {
                        write("<div class='tree'>\n" + key + " : " + obj[key] + ",\n</div>\n");
                    }
                }
                return results;
            };
            renderJSON(obj);
        } else if (type === MIME_PLAIN) {
            var cache = [];
            results = JSON.stringify(obj, function(key, value) {
                if (typeof value === 'object' && value !== null) {
                    if (cache.indexOf(value) !== -1) {
                        // Circular reference found, discard key
                        return;
                    }
                    // Store value in our collection
                    cache.push(value);
                }
                return value;
            }, "  ");
        }

        return results;
    };

    /*------------------------------------------------------------
    - Start up the servers.
    ------------------------------------------------------------*/
    log("Initialize the page cache.");
    var pageCache = new NodeCache(PAGE_CACHE_CONFIG);

    log("Configuration:");
    log(dump(config));

    var watcherPath = PATH.normalize(config.root);
    log("Starting the file watcher: {path}", { path: watcherPath });
    var watcher = chokidar.watch(watcherPath, {persistent: true});
    watcher
        .on('add', function(path) {
            console.log('File', path, 'has been added');
        })
        .on('change', function(path) {
            pageCache.del(path);
            console.log('File', path, 'has been changed');
        })
        .on('unlink', function(path) {
            pageCache.del(path);
            console.log('File', path, 'has been removed');
        });

    log("Starting HTTP server on {port}.", { port: HTTP_PORT });
    var httpServer = http.createServer(onRequest);
    httpServer.listen(HTTP_PORT);
    if (httpServer) {
        log("Server successfully started HTTP server on port: {port}.", { port: HTTP_PORT });
    }

    log("Starting HTTPS server on {port}.", { port: HTTPS_PORT });
    var httpsServer = https.createServer(HTTPS_CONFIG, onRequest);
    httpsServer.listen(HTTPS_PORT);
    if (httpsServer) {
        log("Server successfully started HTTPS server on port: {port}.", { port: HTTPS_PORT });
    }



});
