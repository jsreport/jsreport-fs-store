/* globals define */
define(['app', 'marionette', 'backbone', 'jquery', './socket.io'],
  function (app, Marionette, Backbone, $, io) {
    app.onStartListeners.add(function (cb) {
      cb();

      var definition = app.extensions.manager.extensions.filter(function(e) {
        return e.name === 'fs-store';
      })[0];

      if (!definition.enabled)
        return;

      var lastTemplateDetail;
      app.on('toolbar-render', function (context) {
        if (context.name === 'template-detail') {
          lastTemplateDetail = context;
        } else {
          lastTemplateDetail = null;
        }
      });

      var socket = io();
      socket.on('external-modification', function () {
        if (!lastTemplateDetail) {
          return;
        }

        app.trigger('toastr:info', 'An underlying data has been changed by external process. Reloading the template....');
        lastTemplateDetail.model.fetch({
          success: function () {
            lastTemplateDetail.view.preview();
          }
        });
      });
    });
  });
