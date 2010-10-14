#! /usr/bin/env node

var child_process = require('child_process'),
    http = require('http'),
    sys = require('sys'),
    url = require('url'),
    SocketIOClient = require('./hammertime/socketioclient'),
    BayeuxClient = require('./hammertime/bayeuxclient');

var connectInParallel = 32;

function add (acc, n) {
    return acc + n;
}

function max (a, b) {
    return a > b ? a : b;
}

function min (a, b) {
    return a < b ? a : b;
}

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
TimingStats.prototype.finished = function (id) {
    if (!this.started) return;
    this.started = false;
    sys.puts(JSON.stringify({
        //when: (new Date()).toString(),
        id: id,
        received: this.i,
        attempted: this.total,
        total: this.timings.reduce(add, 0),
        min: this.timings[0],
        max: this.timings[this.i - 1]
    }));
    this.i = 0;
    this.timings = new Array(this.total);
};

function connectSockets (total, dataUrl, verbose, clientClass, onconnect) {
    var urlInfo = url.parse(dataUrl),
        connected = 0,
        connections = 0,
        disconnections = 0,
        errors = 0;

    var connectorCalled = 0;

    setInterval(function () {
        sys.puts(JSON.stringify({
            id: 'connections',
            pid: process.pid,
            connected: connected,
            connections: connections,
            disconnections: disconnections,
            errors: errors
        }));
        connections = disconnections = errors = 0;
    }, 2000);

    var connector = function (n) {
        connectorCalled++;
        var socket = new clientClass(urlInfo.hostname, urlInfo.port, urlInfo.pathname),
            start  = (new Date()).getTime() / 1000,
            states = ['0 - connecting'],
            addState = function (state) {
                var now = (new Date()).getTime() / 1000;
                var time = '' + Math.round((now - start) * 1000) / 1000;
                states.push(time + ' - ' + state);
            };
        socket.on('connect', function () {
            connected++;
            connections++;
            addState('connected');
            if (n > 1) {
                setTimeout(function () {
                    connector(n - 1);
                }, 50);
            }
            onconnect(socket);
            socket.removeAllListeners('connect');
        });

        socket.on('disconnect', function (e) {
            connected--;
            disconnections++;
            addState('disconnected');
            if (verbose) {
                sys.error('socket disconnected:\n' + states.join('\n') + '\n');
            }
            setTimeout(function () {
                connector(1);
            }, 250);
        });

        socket.on('error', function (e) {
            errors++;
            addState('error ' + e + ' (disconnecting)');
            socket.disconnect();
        });
        socket.connect();
    };

    var connectionsPerConnector = Math.ceil(total / connectInParallel);

    for (var i = total; i > 0; i -= connectionsPerConnector) {
        connector(Math.min(connectionsPerConnector, i));
    }
}

function runTest(numClients, url, verbose, clientClass) {
    var messageStats = {},
        timeouts = {},
        seen = {},
        stdin = process.openStdin();

    stdin.on('end', function () {
        sys.error('got end on stdin, exiting');
        process.exit(1);
    });
    stdin.on('error', function () {
        sys.error('got error on stdin, exiting');
        process.exit(1);
    });

    connectSockets(numClients, url, verbose, clientClass, function (client) {
        client.on('error', function (e) {
            sys.error('got error from client ' + e);
        });
        client.on('message', function (data) {
            var id = data.start.toString();
            if (! seen[id]) {
                seen[id] = true;
                timeouts[id] = setTimeout(function () {
                    messageStats[id].finished(id);
                    delete messageStats[id];
                    delete timeouts[id];
                }, 15 * 1000);
                messageStats[id] = new TimingStats(numClients, 'Received');
                messageStats[id].begin(data.start);
            }
            if (id in timeouts) {
                messageStats[id].ping();
                if (messageStats[id].i >= numClients) {
                    messageStats[id].finished(id);
                    delete messageStats[id];
                    clearTimeout(timeouts[id]);
                    delete timeouts[id];
                    delete seen[id];
                }
            }
        });
    });
}

function runPoster(interval, postUrl, data) {
    var proxy = process.env['http_proxy'],
        postInfo,
        connectInfo,
        postPath,
        request,
        port;

    postInfo = url.parse(postUrl);
    connectInfo = proxy ? url.parse(proxy) : postInfo;
    postPath = proxy ? postUrl : postInfo.pathname;
    port = parseInt(connectInfo.port, 10);
    if (! port || isNaN(port)) {
        port = 80;
    }

    var poster = http.createClient(port, connectInfo.hostname);

    setInterval(function () {
        data.start = (new Date()).getTime();
        var postData = JSON.stringify(data);
        request = poster.request('POST', postPath, {
            'Host': postInfo.hostname,
            'User-Agent': 'NodeJS',
            'Content-Type': 'application/json',
            'Content-Length': postData.length
        });
        request.write(postData);
        request.on('response', function (response) {
            if (response.statusCode !== 200) {
                throw new Error('Server error: ' + response.statusCode);
            }
            var received = '';
            response.on('data', function (chunk) {
                received += chunk;
            });
            response.on('end', function () {
            });
        });
        request.end();
    }, interval * 1000);
}

function aggregateAverage (stats) {
    return stats.map(function (i) { return i.total; }).reduce(add) /
           stats.map(function (i) { return i.received; }).reduce(add);
}

function printConnectStats(stats, connected, total) {
    sys.puts('child connected (' + connected + '/' + total + '), min: ' + stats.min + ', max: ' + stats.max + ', avg: ' +  (stats.total / stats.received));
}

function printAggregateStats(stats) {
    var id = parseInt(stats[0].id, 10);
    var started = isNaN(id) ? stats[0].id : new Date(id);
    sys.puts(
        'min: ' + stats.map(function (i) { return i.min; }).reduce(min) + 'ms, ' +
        'max: ' + stats.map(function (i) { return i.max; }).reduce(max) + 'ms, ' +
        'avg: ' + aggregateAverage(stats) + 'ms, ' +
        'rvd: ' + stats.map(function (i) { return i.received; }).reduce(add) + '/' +
                  stats.map(function (i) { return i.attempted; }).reduce(add) +
        '    (' + started + ')'
    );
}

function runSpawnedTest (children, connections, url, verbose, clientClassName) {
    var stats = {},
        connectedChildren = 0,
        connectionStats = {};
    setInterval(function () {
        printConnectionStats(connectionStats, verbose);
    }, 5000);
    for (var i = 0; i < children; i++) {
        spawnChild(
            i, connections, url, verbose, clientClassName,
            function (stat) {
                if (stat.id === 'connections') {
                    handleConnectionStats(connectionStats, stat);
                }
                else {
                    if (! (stat.id in stats)) {
                        stats[stat.id] = [];
                    }
                    stats[stat.id].push(stat);
                    if (stats[stat.id].length === children) {
                        printAggregateStats(stats[stat.id]);
                        delete stats[stat.id];
                    }
                }
            }
        );
    }
}

function printConnectionStats (stats, verbose) {
    var connected = 0,
        connections = 0,
        disconnections = 0,
        errors = 0;
    for (var i in stats) {
        if (verbose) {
            sys.puts(
                'connections (' + i + '): ' +
                'connected: ' + stats[i].connected +
                ', connections: ' + stats[i].connections +
                ', disconnections: ' + stats[i].disconnections +
                ', errors: ' + stats[i].errors
            );
        }
        connected      += stats[i].connected;
        connections    += stats[i].connections;
        disconnections += stats[i].disconnections;
        errors         += stats[i].errors;
    }
    sys.puts(
        'connections (total): ' +
        'connected: ' + connected +
        ', connections: ' + connections +
        ', disconnections: ' + disconnections +
        ', errors: ' + errors
    );
}

function handleConnectionStats (stats, message) {
    if (! (message.pid in stats)) {
        stats[message.pid] = {
            connections: 0,
            disconnections: 0,
            errors: 0
        };
    }
    stats[message.pid].connected = message.connected;
    stats[message.pid].connections += message.connections;
    stats[message.pid].disconnections += message.disconnections;
    stats[message.pid].errors += message.errors;
}


function spawnChild (id, connections, url, verbose, clientClassName, onStats) {
    var args = [process.argv[1], '--run=' + connections, '--url=' + url, '--client-class=' + clientClassName];
    if (verbose) {
        args.push('--verbose');
    }
    var child = child_process.spawn(
        process.argv[0],
        args
    );
    var buffer = '';

    child.stdout.on("data", function (data) {
        buffer += data;
        for (;;) {
            var nl = buffer.indexOf('\n');
            if (nl === -1) {
                break;
            }
            var line = buffer.substr(0, nl);
            buffer = buffer.substr(nl + 1);
            var data = JSON.parse(line);
            onStats(data);
        }
    });
    var error = '';
    child.stderr.on("data", function (data) {
        sys.error(data);
        error += data;
    });
    child.on("exit", function () {
    sys.error('child exited, output to stderr was:\n' + error);
        process.exit(1);
    });
    process.on("exit", function () {
        try {
            child.kill();
        } catch (e) {
        }
    });
    return child;
}

function printUsage () {
    sys.puts("usage: hammertime [ --post=INTERVAL,URL ] [ --spawn=CHILDREN,CONNECTIONS_PER_CHILD ] [ --run=CONNECTIONS ] [ --url=DATA_URL ] [ --client-class=socket.io|bayeaux ] [ --verbose ]");
}

exports.run = function () {
    var post,
        postUrl,
        spawnChildren,
        spawnConnections,
        run,
        match,
        url,
        verbose = false,
        clientClass = SocketIOClient,
        clientClassName = 'socket.io',
        args = process.argv.slice(2);

    for (var i = 0, l = args.length; i < l; i++) {
        if (match = args[i].match(/^--post=(\d+),(.+)$/)) {
            post = parseInt(match[1], 10);
            postUrl = match[2];
        }
        else if (match = args[i].match(/^--spawn=(\d+),(\d+)$/)) {
            spawnChildren = parseInt(match[1], 10);
            spawnConnections = parseInt(match[2], 10);
        }
        else if (match = args[i].match(/^--run=(\d+)$/)) {
            run = parseInt(match[1], 10)
        }
        else if (match = args[i].match(/^--url=(\S+)$/)) {
            url = match[1];
        }
        else if (match = args[i].match(/^--verbose$/)) {
            verbose = true;
        }
        else if (match = args[i].match(/^--client-class=(socket.io|bayeux)$/)) {
            clientClassName = match[1];
            if (match[1] === 'bayeux') {
                clientClass = BayeuxClient;
            }
            // socket.io is the default
        }
        else {
            sys.puts("hammertime: unrecognised option " + args[i]);
            process.exit(1);
        }
    }

    if (! (post || (url && (spawnChildren || run)))) {
        printUsage();
        process.exit(1);
    }

    var data = {
        "testdata":"tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt",
        "content": {'message': {'type': 'hammertime'}}
    };

    if (post) {
        runPoster(post, postUrl, data);
    }

    if (spawnChildren) {
        runSpawnedTest(spawnChildren, spawnConnections, url, verbose, clientClassName);
    }

    if (run) {
        runTest(run, url, verbose, clientClass);
    }

}
