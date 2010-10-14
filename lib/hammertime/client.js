var sys = require('sys');

var Client = module.exports = function () {
    process.EventEmitter.call(this);
    var self = this;
    this.on('connect', function () {
        self.connectedAt = new Date();
    });
};

sys.inherits(Client, process.EventEmitter);
