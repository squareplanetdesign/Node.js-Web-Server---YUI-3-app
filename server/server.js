var http = require("http");
var https = require('https');
var fs = require('fs');
var YUI = require('yui/debug').YUI;


var HTTP_PORT = 8888;
var HTTPS_PORT = 8889;
var HTTPS_CONFIG = {
  key: fs.readFileSync('.ssl/key.pem'),
  cert: fs.readFileSync('.ssl/cert.pem')
};

YUI().use("base", "yui-base", "datatype-date", function(Y) {

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
    var log = function(msg, type, data) {
        if (type && !Y.Lang.isString(type)) {
            data = type;
            type = null;
        }
        type =  type  || "info";
        msg = !data ? msg : substitute(msg, data);
        console.log("[" + type + "] " + now() + " : " + msg);
    };

    /**
     * [now description]
     * @return {[type]} [description]
     */
    var now = function() {
        return Y.Date.format(new Date());
    };


    /**
     * [onRequest description]
     * @param  {[type]} request  [description]
     * @param  {[type]} response [description]
     * @return {[type]}          [description]
     */
    var onRequest = function(request, response) {
        log("Processing request.");
        response.writeHead(200, {"Content-Type": "text/plain"});
        response.write("Hello World");
        response.end();
    };


    /*------------------------------------------------------------
    - Start up the servers.
    ------------------------------------------------------------*/

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
