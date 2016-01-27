'use strict';

const Attache = require('../lib');
const Hapi = require('hapi');


const server = new Hapi.Server({ debug: { log: ['attache'] } });
server.connection({ labels: 'public' });
server.connection({ labels: 'private' });


server.register({
    register: Attache,
    options: {
        service: {
            name: 'myservice'
        }
    }
}, (err) => {

    if (err) {
        throw err;
    }

    server.select('public').route({
        method: 'GET',
        path: '/',
        handler: (request, reply) => {

            return reply('Hello World!');
        }
    });

    server.select('private').route({
        method: 'GET',
        path: '/',
        handler: (request, reply) => {

            return reply('Secret Hello!');
        }
    });

    server.route({
        method: 'GET',
        path: '/_health',
        handler: (request, reply) => {

            return reply('OK');
        }
    });

    let state = 'starting';
    let exitCode = 0;
    const safeExit = () => {

        if (state === 'starting' || state === 'aborted') {         // Abort start if we are just starting
            state = 'aborted';
            return;
        }

        if (state === 'started') {
            state = 'stopping';
            server.stop(() => {

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

    server.start((err) => {

        if (state === 'aborted') {
            err = new Error('aborted');
        }
        state = 'started';

        if (err) {
            console.error('start error:', err.stack);
            return safeExit();
        }

        for (let i = 0; i < server.connections.length; ++i) {
            const connection = server.connections[i];
            console.log('Server ' + connection.settings.labels + ' started at', connection.info.uri);
        }
    });

    // Handle interruptions

    process.on('SIGINT', safeExit);
    process.on('SIGTERM', safeExit);
    process.on('SIGHUP', safeExit);
    process.on('uncaughtException', (err) => {

        console.error('Fatal Exception:', err.stack);
        exitCode = 255;
        return safeExit();
    });
});
