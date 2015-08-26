var Attache = require('../lib');
var Hapi = require('hapi');


var server = new Hapi.Server({ debug: { log: ['attache'] } });
server.connection({ labels: 'public' });
server.connection({ labels: 'private' });


server.register({
    register: Attache,
    options: {
        service: {
            name: 'myservice'
        }
    }
}, function (err) {

    if (err) {
        throw err;
    }

    server.select('public').route({
        method: 'GET',
        path: '/',
        handler: function (request, reply) {

            return reply('Hello World!');
        }
    });

    server.select('private').route({
        method: 'GET',
        path: '/',
        handler: function (request, reply) {

            return reply('Secret Hello!');
        }
    });

    server.route({
        method: 'GET',
        path: '/_health',
        handler: function (request, reply) {

            return reply('OK');
        }
    });

    var state = 'starting';
    var exitCode = 0;
    var safeExit = function () {

        if (state === 'starting' || state === 'aborted') {         // Abort start if we are just starting
            state = 'aborted';
            return;
        }

        if (state === 'started') {
            state = 'stopping';
            server.stop(function () {

                state = 'stopped';
                return safeExit();
            });
            return;
        }

        if (state === 'stopping') {
            return;
        }

        process.exit(exitCode);
    };

    server.start(function (err) {

        if (state === 'aborted') {
            err = new Error('aborted');
        }
        state = 'started';

        if (err) {
            console.error('start error:', err.stack);
            return safeExit();
        }

        for (var idx = 0; idx < server.connections.length; idx++) {
            var connection = server.connections[idx];
            console.log('Server ' + connection.settings.labels + ' started at', connection.info.uri);
        }
    });

    // Handle interruptions

    process.on('SIGINT', safeExit);
    process.on('SIGTERM', safeExit);
    process.on('SIGHUP', safeExit);
    process.on('uncaughtException', function (err) {

        console.error('Fatal Exception:', err.stack);
        exitCode = 255;
        return safeExit();
    });
});
