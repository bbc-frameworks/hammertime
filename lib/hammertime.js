#! /usr/bin/env node

var child_process = require('child_process'),
    http = require('http'),
    sys = require('sys'),
    SocketIOClient = require('./hammertime/socketioclient');

function TimingStats (total, label) {
    this.total = total;
    this.label = label;
    this.started = false;
    this.i = 0;
}
TimingStats.prototype.begin = function (timestamp) {
    if (!timestamp) {
        var d = new Date();
        timestamp = d.getTime();
    }
    this.start = timestamp;
    this.timings = new Array(this.total);
    this.started = true;
};
TimingStats.prototype.ping = function () {
    var d = new Date();
    this.timings[this.i++] = d.getTime() - this.start;
};
TimingStats.prototype.finished = function () {
    if (!this.started) return;
    this.started = false;
    var add = function (acc, n) { return acc + n; };
    sys.log(this.label + ' ' + this.i + '/' + this.total);
    sys.log(
        'avg: ' + (this.timings.reduce(add, 0) / this.i) + 'ms   ' +
        'min: ' + this.timings[0] + 'ms   max: ' + this.timings[this.i - 1] + 'ms'
    );
    this.i = 0;
    this.timings = new Array(this.total);
};

function connectSockets (total, stats, onconnect) {
    var sockets = [],
        step = Math.ceil(total / 8);

    var connector = function (n) {
        var socket = new SocketIOClient('127.0.0.1', 8000);
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

function runTest(numClients) {
    var connectStats = new TimingStats(numClients, 'Connected'),
        messageStats = new TimingStats(numClients, 'Received'),
        clients = [];

    connectStats.begin();
    connectSockets(numClients, connectStats, function (clients) {
        connectStats.finished();

        var last_start = -1,
            seen = 0;
        for (var i = 0; i < numClients; ++i) {
            clients[i].on('message', function (data) {
                /*data = JSON.parse(data);*/
                if (data.start !== last_start) {
                    sys.debug('new timestamp: ' + data.start);
                    messageStats.finished();
                    messageStats.begin(data.start);
                    last_start = data.start;
                    seen = 0;
                }
                messageStats.ping();
                seen += 1;
                if (seen >= numClients) {
                    messageStats.finished();
                }
            });
        }
    });
}

function runPoster(interval, data) {
    var poster = http.createClient(8000, '127.0.0.1'),
        request;

    setInterval(function () {
        data.start = (new Date()).getTime();
        request = poster.request('POST', '/data');
        request.write(JSON.stringify(data));
        request.end();
    }, interval * 1000);
}

function spawnChild (id, connections) {
    var child = child_process.spawn(
        process.argv[0],
        [process.argv[1], '--run=' + connections]
    );
    child.stdout.on("data", function (data) {
        sys.puts("--> from child " + id);
        sys.print(data);
    });
    process.on("exit", function () { child.kill() });
    return child;
}

exports.run = function () {
    var post,
        spawnChildren,
        spawnConnections,
        run,
        match,
        args = process.argv.slice(2);

    for (var i = 0, l = args.length; i < l; i++) {
        if (match = args[i].match(/^--post=(\d+)$/)) {
            post = parseInt(match[1], 10);
        }
        else if (match = args[i].match(/^--spawn=(\d+),(\d+)$/)) {
            spawnChildren = parseInt(match[1], 10);
            spawnConnections = parseInt(match[2], 10);
        }
        else if (match = args[i].match(/^--run=(\d+)$/)) {
            run = parseInt(match[1], 10)
        }
        else {
            sys.puts("formula1: unrecognised option " + args[i]);
            process.exit(1);
        }
    }

    var data = {"CIAF1Update":{"LeaderBoard":{"Driver":[{"position":"1","name":"Felipe Massa","paId":"146"},{"position":"2","name":"Fernando Alonso","paId":"140"},{"position":"3","name":"Kimi Raikkonen","paId":"141"},{"position":"4","name":"Sebastian Vettel","paId":"459"},{"position":"5","name":"Lewis Hamilton","paId":"550"},{"position":"6","name":"Heikki Kovalainen","paId":"204"},{"position":"7","name":"Jarno Trulli","paId":"97"},{"position":"8","name":"Robert Kubica","paId":"356"},{"position":"9","name":"David Coulthard","paId":"78"},{"position":"10","name":"Mark Webber","paId":"149"},{"position":"11","name":"Nick Heidfeld","paId":"134"},{"position":"12","name":"Timo Glock","paId":"159"},{"position":"13","name":"Sebastien Bourdais","paId":"696"},{"position":"14","name":"Nelson Piquet Jr.","retired":"true","paId":"479"},{"position":"15","name":"Nico Rosberg","retired":"true","paId":"355"},{"position":"16","name":"Jenson Button","retired":"true","paId":"135"},{"position":"17","name":"Giancarlo Fisichella","retired":"true","paId":"94"},{"position":"18","name":"Rubens Barrichello","retired":"true","paId":"64"},{"position":"19","name":"Adrian Sutil","retired":"true","paId":"441"},{"position":"20","name":"Kazuki Nakajima","retired":"true","paId":"557"}],"lapsCompleted":"81","comment":"Massive pile up on the first bend. Surely the race has to be stopped."},"stageName":"Race","userId":"jones","paStageId":"3353"}};

    if (post) {
        runPoster(post, data);
    }

    if (spawnChildren) {
        for (var i = 0; i < spawnChildren; i++) {
            spawnChild(i, spawnConnections);
        }
    }

    if (run) {
        runTest(run);
    }

    if (! (post || spawnChildren || run)) {
        sys.puts("usage: hammertime [ --post=INTERVAL ] [ --spawn=CHILDREN,CONNECTIONS_PER_CHILD ] [ --run=CONNECTIONS ]");
    }
}
