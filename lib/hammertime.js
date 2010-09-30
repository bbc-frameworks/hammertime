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

function TimingStats (total, label) {
    this.total = total;
    this.label = label;
}
TimingStats.prototype.begin = function () {
    var d = new Date();
    this.start = d.getTime();
    this.timings = [];
};
TimingStats.prototype.ping = function () {
    var d = new Date();
    this.timings.push(d.getTime() - this.start);
};
TimingStats.prototype.finished = function () {
    var add = function (acc, n) { return acc + n; };
    sys.log(this.label + ' ' + this.timings.length + '/' + this.total);
    sys.log(
        'avg: ' + (this.timings.reduce(add, 0) / this.timings.length) + 'ms   ' +
        'min: ' + this.timings[0] + 'ms   max: ' + this.timings[this.timings.length - 1] + 'ms'
    );
};

function connectSockets (total, stats, onconnect) {
    var sockets = [],
        step = Math.ceil(total / 8);

    var connector = function (n) {
        var socket = new io.Socket('127.0.0.1', {
            port: 8000,
            transports: ['websocket'],
            rememberTransport: false
        });
        socket.on('connect', function () {
            stats.ping();
            sockets.push(socket);
            if (n > 1) {
                connector(n - 1);
            } else if (sockets.length === total) {
                onconnect(sockets);
            }
        });
        socket.on('error', function (e) {
            sys.debug('error connecting socket: ' + e);
            setTimeout(function () {
                connector(n);
            }, 250);
        });
        socket.connect();
    };

    for (var i = total; i > 0; i -= step) {
        connector(Math.min(step, i));
    }
}

function runTest(numClients, data) {
    var connectStats = new TimingStats(numClients, 'Connected'),
        messageStats = new TimingStats(numClients, 'Received'),
        clients = [],
        poster = http.createClient(8000, '127.0.0.1'),
        request;

    connectStats.begin();
    connectSockets(numClients, connectStats, function (clients) {
        connectStats.finished();

        for (var i = 0; i < numClients; ++i) {
            clients[i].on('message', function (data) {
                messageStats.ping();
            });
        }

        setInterval(function () {
            messageStats.begin();
            request = poster.request('POST', '/data');
            request.write(data);
            request.end();
            setTimeout(function () {
                messageStats.finished();
            }, 4000);
        }, 5000);
    });
}

exports.run = function () {
    runTest(1000, 'hello world');
}
