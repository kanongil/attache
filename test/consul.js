// Load modules

var Code = require('code');
var Consul = require('consul');
var Hapi = require('hapi');
var HapiConsul = require('../lib');
var Hoek = require('hoek');
var Lab = require('lab');


// Declare internals

var internals = {
    consul: Consul()
};


// Test shortcuts

var lab = exports.lab = Lab.script();
var describe = lab.describe;
var it = lab.it;
var expect = Code.expect;


describe('plugin', function () {

    it('registers on start', function (done) {

        var server = new Hapi.Server();
        server.connection();

        server.register(HapiConsul, Hoek.ignore);

        internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        }, function (err, list1) {

            expect(err).to.not.exist();
            server.start(function (err) {

                expect(err).to.not.exist();
                internals.consul.catalog.service.nodes({
                    service: 'hapi',
                    consistent: true
                }, function (err, list2) {

                    expect(err).to.not.exist();
                    server.stop(function (err) {

                        expect(err).to.not.exist();
                        expect(list1).to.have.length(0);
                        expect(list2).to.have.length(1);
                        done();
                    });
                });
            });
        });
    });

    it('creates tags from labels', function (done) {

        var server = new Hapi.Server();
        server.connection({ labels: ['b', 'c', 'a', 'b'], host: 'localhost' });

        server.register(HapiConsul, Hoek.ignore);

        internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        }, function (err, list1) {

            expect(err).to.not.exist();
            server.start(function (err) {

                expect(err).to.not.exist();
                internals.consul.catalog.service.nodes({
                    service: 'hapi',
                    consistent: true
                }, function (err, list2) {

                    expect(err).to.not.exist();
                    server.stop(function (err) {

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

    it('handles multiple connections', function (done) {

        var server = new Hapi.Server();
        server.connection({ labels: 'a' });
        server.connection({ labels: 'b', plugins: { attache: { id: '+hapitest:b' } } });

        server.register(HapiConsul, Hoek.ignore);

        internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        }, function (err, list1) {

            expect(err).to.not.exist();
            server.start(function (err) {

                expect(err).to.not.exist();
                internals.consul.catalog.service.nodes({
                    service: 'hapi',
                    consistent: true
                }, function (err, list2) {

                    expect(err).to.not.exist();
                    server.stop(function (err) {

                        expect(err).to.not.exist();
                        expect(list1).to.have.length(0);
                        expect(list2).to.have.length(2);
                        done();
                    });
                });
            });
        });
    });

    it('start() returns error on missing consul api access', function (done) {

        var server = new Hapi.Server();
        server.connection();

        server.register({
            register: HapiConsul,
            options: {
                consul: {
                    host: 'does.not.exist'
                }
            }
        }, Hoek.ignore);

        server.start(function (err1) {

            expect(err1).to.exist();

            return server.stop(function (err2) {

                expect(err2).to.not.exist();
                done();
            });
        });
    });

    it('throws on invalid registration options', function (done) {

        var server = new Hapi.Server();
        server.connection();

        var register = function () {

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

    it('throws on invalid connection plugin options', function (done) {

        var server = new Hapi.Server();
        server.connection({ plugins: { attache: { unknown: true } } });

        var register = function () {

            server.register(HapiConsul, Hoek.ignore);
        };

        expect(register).to.throw(/^Invalid plugin connection options/);
        done();
    });

    it('supports manual maintenance mode', function (done) {

        var serviceName = '+hapitest:maint';
        var config = { plugins: { attache: { id: serviceName } } };
        var server = new Hapi.Server();
        server.connection(config);

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    name: serviceName
                }
            }
        }, Hoek.ignore);

        server.start(function (err1) {

            expect(err1).to.not.exist();

            server.consul.maintenance('Emergency!', function (err2) {

                expect(err2).to.not.exist();

                server.consul.maintenance(function (err3, status1) {

                    expect(err3).to.not.exist();
                    expect(status1.length).to.equal(1);
                    expect(status1[0]).to.include({
                        Status: 'critical',
                        Notes: 'Emergency!'
                    });

                    server.consul.maintenance(false, function (err4) {

                        expect(err4).to.not.exist();

                        server.consul.maintenance(function (err5, status2) {

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

    it('performs health check', function (done) {

        var server = new Hapi.Server();
        server.connection({ plugins: { attache: { id: '+hapitest:health' } } });

        server.register({
            register: HapiConsul,
            options: {
                service: {
                    check: {
                        interval: 1000
                    }
                }
            }
        }, Hoek.ignore);

        server.route({
            method: 'GET',
            path: '/_health',
            handler: function (request, reply) {

                return reply('OK');
            }
        });

        server.start(function (err) {

            expect(err).to.not.exist();
            internals.consul.agent.check.list(function (err, result1) {

                expect(err).to.not.exist();
                setTimeout(function () {

                    internals.consul.agent.check.list(function (err, result2) {

                        expect(err).to.not.exist();
                        server.stop(function (err) {

                            expect(err).to.not.exist();
                            expect(result1['service:+hapitest:health']).to.exist();
                            expect(result1['service:+hapitest:health']).to.include({
                                Status: 'critical'
                            });
                            expect(result2['service:+hapitest:health']).to.include({
                                Status: 'passing',
                                Output: 'HTTP GET ' + server.info.uri + '/_health: 200 OK Output: OK'
                            });
                            done();
                        });
                    });
                }, 1000);
            });
        });
    });

    it('handles disabled check.path option', function (done) {

        var server = new Hapi.Server();
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

        server.start(function (err1) {

            expect(err1).to.not.exist();

            internals.consul.agent.check.list(function (err2, result) {

                expect(err2).to.not.exist();
                expect(result).to.not.include('service:+hapitest');

                server.stop(done);
            });
        });
    });

    it('forwards maintenance() backend errors', function (done) {

        var server = new Hapi.Server();
        server.connection({ plugins: { attache: { id: '+hapitest:deregisterfail' } } });

        server.register(HapiConsul, Hoek.ignore);

        server.start(function (err1) {

            expect(err1).to.not.exist();

            var saved1 = server.consul.api.agent.check.list;
            server.consul.api.agent.check.list = function (callback) {

                server.consul.api.agent.check.list = saved1;
                return callback(new Error('failed'));
            };

            server.consul.maintenance(function (err2) {

                expect(err2).to.exist();

                var saved2 = server.consul.api.agent.service.maintenance;
                server.consul.api.agent.service.maintenance = function (opts, callback) {

                    server.consul.api.agent.service.maintenance = saved2;
                    return callback(new Error('failed'));
                };

                server.consul.maintenance(false, function (err3) {

                    expect(err3).to.exist();

                    server.stop(function (err4) {

                        expect(err4).to.not.exist();
                        done();
                    });
                });
            });
        });
    });
});
