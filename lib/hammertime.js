#! /usr/bin/env node

function loadSocketIO() {
    var fs = require('fs'),
        WebSocket = require(__dirname + '/../ext/node-websocket-client/lib/websocket').WebSocket,
        Script = process.binding('evals').Script,
        code = fs.readFileSync(__dirname + '/../ext/Socket.IO/socket.io.js'),
        context = {
            WebSocket: WebSocket,
            document: {
                location: { port: 8000 },
                readyState: 'complete'
            },
            navigator: {
                userAgent: 'node.js',
                platform: 'calculator'
            }
        };
    context.window = context;
    Script.runInNewContext(code, context, 'socket.io.js');
    return context.io;
}

var http = require('http'),
    io = loadSocketIO(),
    sys = require('sys');

function ClientStats() {
    this.start = null;
    this.received = [];
}
ClientStats.prototype.starting = function () {
    var d = new Date(),
        self = this;
    this.start = d.getTime();
    this.received = [];
    setTimeout(function () {
        self.end();
    }, 2000);
};
ClientStats.prototype.receive = function (data) {
    var d = new Date();
    this.received.push(d.getTime());
};
ClientStats.prototype.end = function () {
    sys.debug(sys.inspect(this));
};

function makeClient(stats) {
    var socket = new io.Socket('127.0.0.1', {
        port: 8000,
        transports: ['websocket'],
        rememberTransport: false
    });
    socket.on('message', function (data) {
        stats.receive(data);
    });
    //socket.on('disconnect', function () {
    //    sys.debug('disconnect');
    //});
    socket.connect();
    return socket;
}

exports.run = function () {
    var stats = new ClientStats(),
        clients = [];

    for (var i = 100; i >= 0; --i) {
        clients.push(makeClient(stats));
    }

    var poster = http.createClient(8000, '127.0.0.1'),
        request = poster.request('POST', '/data');
    request.write('hello world');
    stats.starting();
    request.end();
}
