#! /usr/bin/env node

var http = require('http'),
    io = require('./socketio-client').io,
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
    var socket = new io.Socket('127.0.0.1', {'port': 8000, 'transports': ['websocket']});
    socket.on('message', function (data) {
        stats.receive(data);
    });
    //socket.on('disconnect', function () {
    //    sys.debug('disconnect');
    //});
    socket.connect();
    return socket;
}

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