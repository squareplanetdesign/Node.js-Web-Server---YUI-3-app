var config = require('./config');

var http = require("http");
var https = require('https');
var fs = require('fs');
var YUI = require('yui/debug').YUI;
var PATH = require('path');
var URL = require('url');

var MIME_PLAIN = "text/plain";
var MIME_HTML = "text/html";

var HTTP_PORT = 8888;
var HTTPS_PORT = 8889;
var HTTPS_CONFIG = {
  key: fs.readFileSync('.ssl/key.pem'),
  cert: fs.readFileSync('.ssl/cert.pem')
};

var DEFAULT_MAX_CACHED_PAGES = 5;
var PAGE_CACHE_CONFIG = {
    max: config.cache.maxPages || DEFAULT_MAX_CACHED_PAGES,
    expires: config.cache.expires,
    uniqueKeys: false
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

    var pageCache = new Y.Cache();

    /**
     * [getRequestFilePath description]
     * @param  {[type]} request [description]
     * @return {[type]}         [description]
     */
    var getRequestFilePath = function(request) {
        var url = URL.parse(request.url, true);
        if (!url.pathName) {
            return buildPath(config["default"] || "default.html");
        } else {
            return buildPath(url.pathName);
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
     * [writeFile description]
     * @param  {[type]} filePath [description]
     * @param  {[type]} response [description]
     * @param  {[type]} args     [description]
     * @return {[type]}          [description]
     */
    var writeFile = function(filePath, request, response, args) {
        var content = pageCache.retrieve(filePath);
        if (content) {
            var out = !args ? content : substitute(content, args);
            writeContent(request, response, content, MIME_HTML, 200);
        } else {
            fs.readFile(filePath, function(error, content) {
                if (error) {
                    writeFile(buildPath("404.html"), request, response, { path : filePath, error : error, terminate: true });
                    return;
                }

                if (content) {
                    pageCache.add(filePath, content);
                } else {
                    writeFile(buildPath("404.html"), request, response, { path : filePath, error : error, terminate: true });
                    return;
                }

                writeContent(request, response, content, MIME_HTML, 200);
            });
        }
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
        writeDebuggingContent(request, response);
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
        log(substitute("Requested file: {path}.", { path: filePath }));
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
    log("Configuration:");
    log(dump(config));

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
