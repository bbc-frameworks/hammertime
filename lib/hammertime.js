#! /usr/bin/env node

var http = require('http'),
    sys = require('sys'),
    io = loadSocketIO();

function loadSocketIO() {
    var fs = require('fs'),
        WebSocket = require(__dirname + '/../ext/node-websocket-client/lib/websocket').WebSocket,
        Script = process.binding('evals').Script,
        code = fs.readFileSync(__dirname + '/../ext/Socket.IO/socket.io.js'),
        context = {
            WebSocket: WebSocket,
            window: { WebSocket: WebSocket },
            document: {
                location: { port: 8000 },
                readyState: 'complete'
            },
            navigator: {
                userAgent: 'node.js',
                platform: 'calculator'
            },
            setTimeout: setTimeout,
            clearTimeout: clearTimeout
        };
    WebSocket.prototype.send = { toString: function () { return "native" } };
    Script.runInNewContext(code, context, 'socket.io.js');
    return context.io;
}


function ClientStats() {
    this.start = null;
    this.received = [];
}
ClientStats.prototype.begin = function (numClients) {
    var d = new Date();
    this.numClients = numClients;
    this.start = d.getTime();
    this.received = [];
};
ClientStats.prototype.receive = function (data) {
    var d = new Date();
    this.received.push(d.getTime() - this.start);
};
ClientStats.prototype.end = function () {
    sys.debug(sys.inspect(this));

    var completed = this.received.length,
        average = 0.0;

    for (var i = completed - 1; i >= 0; --i) {
        average += this.received[i];
    }
    average = average / completed;
    sys.debug('Completed ' + completed + '/' + this.numClients);
    sys.debug('Average: ' + average + 'ms');
    sys.debug('Best: ' + this.received[0] + 'ms; Worst: ' + this.received[completed - 1] + 'ms');
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

    for (var i = 100; i > 0; --i) {
        clients.push(makeClient(stats));
    }

    var poster = http.createClient(8000, '127.0.0.1'),
        request = poster.request('POST', '/data');
    request.write('hello world');
    stats.begin(clients.length);
    request.end();
    setTimeout(function () {
        stats.end();
    }, 2000);
}
