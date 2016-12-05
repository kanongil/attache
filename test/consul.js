'use strict';

// Load modules

const Code = require('code');
const Consul = require('consul');
const Hapi = require('hapi');
const HapiConsul = require('..');
const Hoek = require('hoek');
const Lab = require('lab');


// Declare internals

const internals = {
    consul: Consul()
};


// Test shortcuts

const lab = exports.lab = Lab.script();
const describe = lab.describe;
const it = lab.it;
const expect = Code.expect;


describe('plugin', () => {

    it('registers on start', (done) => {

        const server = new Hapi.Server();
        server.connection();

        server.register(HapiConsul, Hoek.ignore);

        internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        }, (err, list1) => {

            expect(err).to.not.exist();
            server.start((err) => {

                expect(err).to.not.exist();
                internals.consul.catalog.service.nodes({
                    service: 'hapi',
                    consistent: true
                }, (err, list2) => {

                    expect(err).to.not.exist();
                    server.stop((err) => {

                        expect(err).to.not.exist();
                        expect(list1).to.have.length(0);
                        expect(list2).to.have.length(1);
                        done();
                    });
                });
            });
        });
    });

    it('creates tags from labels', (done) => {

        const server = new Hapi.Server();
        server.connection({ labels: ['b', 'c', 'a', 'b'], host: 'localhost' });

        server.register(HapiConsul, Hoek.ignore);

        internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        }, (err, list1) => {

            expect(err).to.not.exist();
            server.start((err) => {

                expect(err).to.not.exist();
                internals.consul.catalog.service.nodes({
                    service: 'hapi',
                    consistent: true
                }, (err, list2) => {

                    expect(err).to.not.exist();
                    server.stop((err) => {

                        expect(err).to.not.exist();
                        expect(list1).to.have.length(0);
                        expect(list2).to.have.length(1);
                        expect(list2[0].ServiceTags).to.exist();
                        expect(list2[0].ServiceTags).to.only.once.include(['a', 'b', 'c']);
                        done();
                    });
                });
            });
        });
    });

    it('supports custom hostnames', (done) => {

        const server = new Hapi.Server();
        server.connection({ host: 'localhost' });

        server.register(HapiConsul, Hoek.ignore);

        internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        }, (err, list1) => {

            expect(err).to.not.exist();
            server.start((err) => {

                expect(err).to.not.exist();
                internals.consul.catalog.service.nodes({
                    service: 'hapi',
                    consistent: true
                }, (err, list2) => {

                    expect(err).to.not.exist();
                    server.stop((err) => {

                        expect(err).to.not.exist();
                        expect(list1).to.have.length(0);
                        expect(list2).to.have.length(1);
                        expect(list2[0]).to.include({ ServiceAddress: '127.0.0.1' });
                        done();
                    });
                });
            });
        });
    });

    it('handles multiple connections', (done) => {

        const server = new Hapi.Server();
        server.connection({ labels: 'a' });
        server.connection({ labels: 'b', plugins: { attache: { id: '+hapitest:b' } } });

        server.register(HapiConsul, Hoek.ignore);

        internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        }, (err, list1) => {

            expect(err).to.not.exist();
            server.start((err) => {

                expect(err).to.not.exist();
                internals.consul.catalog.service.nodes({
                    service: 'hapi',
                    consistent: true
                }, (err, list2) => {

                    expect(err).to.not.exist();
                    server.stop((err) => {

                        expect(err).to.not.exist();
                        expect(list1).to.have.length(0);
                        expect(list2).to.have.length(2);
                        done();
                    });
                });
            });
        });
    });

    it('starts in a healthy state', (done) => {

        const server = new Hapi.Server();
        server.connection();

        server.register(HapiConsul, Hoek.ignore);

        server.start((err) => {

            expect(err).to.not.exist();
            internals.consul.agent.check.list((err, map) => {

                expect(err).to.not.exist();

                const checkId = 'service:' + server.consul.connectionId(server.connections[0]);

                server.stop((err) => {

                    expect(err).to.not.exist();
                    expect(map).to.include(checkId);
                    expect(map[checkId]).to.include({
                        Status: 'passing'
                    });
                    done();
                });
            });
        });
    });

    it('start() returns error on missing consul api access', (done) => {

        const server = new Hapi.Server();
        server.connection();

        server.register({
            register: HapiConsul,
            options: {
                consul: {
                    host: 'does.not.exist'
                }
            }
        }, Hoek.ignore);

        server.start((err1) => {

            expect(err1).to.exist();

            return server.stop((err2) => {

                expect(err2).to.not.exist();
                done();
            });
        });
    });

    it('throws on invalid registration options', (done) => {

        const server = new Hapi.Server();
        server.connection();

        const register = () => {

            server.register({
                register: HapiConsul,
                options: {
                    service: {
                        name: false
                    }
                }
            }, Hoek.ignore);
        };

        expect(register).to.throw(/^Invalid plugin options/);
        done();
    });

    it('throws on invalid connection plugin options', (done) => {

        const server = new Hapi.Server();
        server.connection({ plugins: { attache: { unknown: true } } });

        const register = () => {

            server.register(HapiConsul, Hoek.ignore);
        };

        expect(register).to.throw(/^Invalid plugin connection options/);
        done();
    });

    it('supports manual maintenance mode', (done) => {

        const serviceName = '+hapitest:maint';
        const config = { plugins: { attache: { id: serviceName } } };
        const server = new Hapi.Server();
        server.connection(config);

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    name: serviceName
                }
            }
        }, Hoek.ignore);

        server.start((err1) => {

            expect(err1).to.not.exist();

            server.consul.maintenance('Emergency!', (err2) => {

                expect(err2).to.not.exist();

                server.consul.maintenance((err3, status1) => {

                    expect(err3).to.not.exist();
                    expect(status1.length).to.equal(1);
                    expect(status1[0]).to.include({
                        Status: 'critical',
                        Notes: 'Emergency!'
                    });

                    server.consul.maintenance(false, (err4) => {

                        expect(err4).to.not.exist();

                        server.consul.maintenance((err5, status2) => {

                            expect(err5).to.not.exist();
                            expect(status2.length).to.equal(1);
                            expect(status2[0]).to.equal(false);

                            server.stop(done);
                        });
                    });
                });
            });
        });
    });

    it('performs http health check', (done) => {

        const server = new Hapi.Server();
        server.connection({ host: 'localhost', plugins: { attache: { id: '+hapitest:health' } } });

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    check: {
                        interval: 1000,
                        startHealthy: false
                    }
                }
            }
        }, Hoek.ignore);

        server.route({
            method: 'GET',
            path: '/_health',
            handler: (request, reply) => {

                return reply('OK');
            }
        });

        server.start((err) => {

            expect(err).to.not.exist();
            internals.consul.agent.check.list((err, result1) => {

                expect(err).to.not.exist();
                setTimeout(() => {

                    internals.consul.agent.check.list((err, result2) => {

                        expect(err).to.not.exist();
                        server.stop((err) => {

                            expect(err).to.not.exist();
                            expect(result1).to.include('service:+hapitest:health');
                            expect(result1['service:+hapitest:health']).to.include({
                                Status: 'critical'
                            });
                            expect(result2).to.include('service:+hapitest:health');
                            expect(result2['service:+hapitest:health']).to.include({
                                Status: 'passing',
                                Output: 'HTTP GET ' + server.info.uri + '/_health: 200 OK Output: OK'
                            });
                            done();
                        });
                    });
                }, 1200);
            });
        });
    });

    it('supports ttl check-in', (done) => {

        const server = new Hapi.Server();
        server.connection({ plugins: { attache: { id: '+hapitest:health2' } } });

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    check: {
                        ttl: '2s'
                    }
                }
            }
        }, Hoek.ignore);

        server.start((err) => {

            expect(err).to.not.exist();
            internals.consul.agent.check.list((err, result1) => {

                expect(err).to.not.exist();
                server.consul.checkin(undefined, 'huh?', (err) => {

                    expect(err).to.not.exist();
                    internals.consul.agent.check.list((err, result2) => {

                        expect(err).to.not.exist();
                        server.consul.checkin(false, 'bonkers…', (err) => {

                            expect(err).to.not.exist();
                            internals.consul.agent.check.list((err, result3) => {

                                expect(err).to.not.exist();
                                server.stop((err) => {

                                    expect(err).to.not.exist();
                                    expect(result1).to.include('service:+hapitest:health2:2');
                                    expect(result1['service:+hapitest:health2:2']).to.include({
                                        Status: 'passing'
                                    });
                                    expect(result2).to.include('service:+hapitest:health2:2');
                                    expect(result2['service:+hapitest:health2:2']).to.include({
                                        Status: 'warning',
                                        Output: 'huh?'
                                    });
                                    expect(result3).to.include('service:+hapitest:health2:2');
                                    expect(result3['service:+hapitest:health2:2']).to.include({
                                        Status: 'critical',
                                        Output: 'bonkers…'
                                    });
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it('supports ttl check-in with disabled http check', (done) => {

        const server = new Hapi.Server();
        server.connection({ plugins: { attache: { id: '+hapitest:health3' } } });

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    check: {
                        path: false,
                        ttl: '2s',
                        startHealthy: false
                    }
                }
            }
        }, Hoek.ignore);

        server.start((err) => {

            expect(err).to.not.exist();
            internals.consul.agent.check.list((err, result1) => {

                expect(err).to.not.exist();
                server.consul.checkin(true, (err) => {

                    expect(err).to.not.exist();
                    internals.consul.agent.check.list((err, result2) => {

                        expect(err).to.not.exist();
                        server.stop((err) => {

                            expect(err).to.not.exist();
                            expect(result1).to.include('service:+hapitest:health3');
                            expect(result1['service:+hapitest:health3']).to.include({
                                Status: 'critical'
                            });
                            expect(result2).to.include('service:+hapitest:health3');
                            expect(result2['service:+hapitest:health3']).to.include({
                                Status: 'passing',
                                Output: ''
                            });
                            done();
                        });
                    });
                });
            });
        });
    });

    it('reports check-in errors', (done) => {

        const server = new Hapi.Server();
        server.connection({ plugins: { attache: { id: '+hapitest:health4' } } });

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    check: {
                        path: false,
                        ttl: '2s'
                    }
                }
            }
        }, Hoek.ignore);

        server.consul.checkin(true, (err) => {

            expect(err).to.exist();
            done();
        });
    });

    it('supports check-in without callback', (done) => {

        const server = new Hapi.Server();
        server.connection({ plugins: { attache: { id: '+hapitest:health5' } } });

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    check: {
                        path: false,
                        ttl: '2s'
                    }
                }
            }
        }, Hoek.ignore);

        server.consul.checkin(true);
        done();
    });

    it('handles disabled check.path option', (done) => {

        const server = new Hapi.Server();
        server.connection({ plugins: { attache: { id: '+hapitest' } } });

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    check: {
                        path: false
                    }
                }
            }
        }, Hoek.ignore);

        server.start((err1) => {

            expect(err1).to.not.exist();

            internals.consul.agent.check.list((err2, result) => {

                expect(err2).to.not.exist();
                expect(result).to.not.include('service:+hapitest');

                server.stop(done);
            });
        });
    });

    it('forwards maintenance() backend errors', (done) => {

        const server = new Hapi.Server();
        server.connection({ plugins: { attache: { id: '+hapitest:deregisterfail' } } });

        server.register(HapiConsul, Hoek.ignore);

        server.start((err1) => {

            expect(err1).to.not.exist();

            const saved1 = server.consul.api.agent.check.list;
            server.consul.api.agent.check.list = (callback) => {

                server.consul.api.agent.check.list = saved1;
                return callback(new Error('failed'));
            };

            server.consul.maintenance((err2) => {

                expect(err2).to.exist();

                const saved2 = server.consul.api.agent.service.maintenance;
                server.consul.api.agent.service.maintenance = (opts, callback) => {

                    server.consul.api.agent.service.maintenance = saved2;
                    return callback(new Error('failed'));
                };

                server.consul.maintenance(false, (err3) => {

                    expect(err3).to.exist();

                    server.stop((err4) => {

                        expect(err4).to.not.exist();
                        done();
                    });
                });
            });
        });
    });
});
