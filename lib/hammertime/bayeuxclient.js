var sys = require('sys'),
    Client = require('./client');

var BayeuxClient = module.exports = function (host, port) {
    var self = this;
    Client.call(this);
    this.socket = new io.Socket(host, {
        port: port,
        transports: ['websocket'],
        rememberTransport: false
    });
    this.socket.on('connect', function () {
        self.emit('connect');
    });
    this.socket.on('error', function (e) {
        self.emit('error', e);
    });
    this.socket.on('message', function (data) {
        self.emit('message', JSON.parse(data));
    });
};
sys.inherits(BayeuxClient, Client);

BayeuxClient.prototype.connect = function () {
    return this.socket.connect();
};
