'use strict';

require('../app');
var angular = require('angular');

angular.module('deckApp')
  .factory('loadBalancerService', function (searchService, settings, $q, Restangular, _) {

    var oortEndpoint = Restangular.withConfig(function (RestangularConfigurer) {
      RestangularConfigurer.setBaseUrl(settings.oortUrl);
    });

    function loadLoadBalancers(application) {
      var loadBalancerNames = [],
        loadBalancerPromises = [];

      application.accounts.forEach(function(account) {
        var accountClusters = application.clusters[account];
        accountClusters.forEach(function(cluster) {
          loadBalancerNames.push(cluster.loadBalancers);
        });
      });

      loadBalancerNames = _.unique(_.flatten(loadBalancerNames));

      loadBalancerNames.forEach(function(loadBalancer) {
        var loadBalancerPromise = getLoadBalancer(loadBalancer, application);
        loadBalancerPromises.push(loadBalancerPromise);
      });

      return $q.all(loadBalancerPromises).then(_.flatten);

    }

    function updateHealthCounts(loadBalancer) {
      var instances = loadBalancer.instances;
      loadBalancer.healthCounts = {
        upCount: instances.filter(function (instance) {
          return instance.healthStatus === 'Healthy';
        }).length,
        downCount: instances.filter(function (instance) {
          return instance.healthStatus === 'Unhealthy';
        }).length,
        unknownCount: instances.filter(function (instance) {
          return instance.healthStatus === 'Unknown';
        }).length
      };
    }

    function getLoadBalancer(name) {
      var promise = oortEndpoint.one('aws').one('loadBalancers', name).get();
      return promise.then(function(loadBalancerRollup) {
        if (angular.isUndefined(loadBalancerRollup)) { return []; }
        var loadBalancers = [];
        loadBalancerRollup.accounts.forEach(function (account) {
          account.regions.forEach(function (region) {
            region.loadBalancers.forEach(function (loadBalancer) {
              loadBalancer.account = account.name;
              loadBalancers.push(loadBalancer);
            });
          });
        });
        return loadBalancers;
      });
    }

    function normalizeLoadBalancersWithServerGroups(application) {
      application.loadBalancers.forEach(function(loadBalancer) {
        var serverGroups = application.serverGroups.filter(function(serverGroup) {
          return serverGroupIsInLoadBalancer(serverGroup, loadBalancer);
        });
        loadBalancer.serverGroups = serverGroups;
        loadBalancer.instances =  _.flatten(_.collect(serverGroups, 'instances'));
        updateHealthCounts(loadBalancer);
      });
    }

    function serverGroupIsInLoadBalancer(serverGroup, loadBalancer) {
      if (serverGroup.region !== loadBalancer.region || loadBalancer.serverGroups.indexOf(serverGroup.name) === -1) {
        return false;
      }
      // only include if load balancer is fronting an instance
      try {
        var elbInstanceIds = _.pluck(loadBalancer.elb.instances, 'instanceId'),
          serverGroupInstanceIds = _.pluck(serverGroup.instances, 'instanceId');
        return elbInstanceIds.some(function (elbInstanceId) {
          return serverGroupInstanceIds.indexOf(elbInstanceId) !== -1;
        });
      } catch (e) {
        return false;
      }
    }


    return {
      loadLoadBalancers: loadLoadBalancers,
      normalizeLoadBalancersWithServerGroups: normalizeLoadBalancersWithServerGroups,
      serverGroupIsInLoadBalancer: serverGroupIsInLoadBalancer
    };

  });
