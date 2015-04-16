var express = require('express');
var router = express.Router();
var Models = require('octopus-models-api');
var sizeof = require('object-sizeof');

router.use(function(req, res, next) {
	//roughly 67M
	if (sizeof(Models.Application.loadedAppModels) > (1 << 26)) {
		delete Models.Application.loadedAppModels;
		Models.Application.loadedAppModels = {};
	}

	if (!Models.Application.loadedAppModels[req.get('X-BLGREQ-APPID')]) {
		Models.Application.loadAppModels(req.get('X-BLGREQ-APPID'), next);
	} else
		next();
});

router.post('/subscribe', function(req, res, next) {
	var id = req.body.id;
	var context = req.body.context;
	var deviceId = req.body.device_id;
	var userId = req.body.user_id;
	var userToken = req.body.user_token;
	var mdl = req.body.model;
	var appId = req.get('X-BLGREQ-APPID');
	/**
	 * {
					 * 		parent: {model: event, id: 1}
					 * 		user: 1
					 *
					 * }
	 */
	var filters = req.body.filters;

	if (!context)
		res.status(400).json({status: 400, message: "Requested context is not provided."}).end();
	else if (!deviceId)
		res.status(400).json({status: 400, message: "Requested deviceID is not provided."}).end();
	//ia-le pe toate
	else {
		async.waterfall([
			//see if device exists
			function(callback) {
				Models.Subscription.getDevice(deviceId, function(err, results) {
					if (err) {
						if (err.code == 13) {
							return callback(null, false);
						} else
							return callback(err, null);
					}

					callback(null, results);
				});
			},
			//create it if it doesn't
			function(deviceResult, callback) {
				if (deviceResult === false) {
					Models.Subscription.addDevice({id: deviceId, user_id: userId, user_token: userToken}, function(err, result) {
						callback(err, null);
					});
				} else {
					callback(null, null);
				}
			},
			//finally, add subscription
			function(result, callback) {
				var parent = {};
				var user = null;
				if (filters && filters.parent) {
					parent.model = Models.Application.loadedAppModels[appId][filters.parent.name].namespace;
					parent.id = filters.parent.id;
				}
				if (filters && filters.user)
					user = filters.user;

				console.log(Models.Application.loadedAppModels);
				Models.Subscription.add(context, deviceId, {model: Models.Application.loadedAppModels[appId][mdl].namespace, id: id}, user, parent,  callback);
			},
			function(result, callback) {
				if(!id) {
					if (filters) {
						for (var rel in Models.Application.loadedAppModels[appId][mdl].belongsTo) {
							var parentModelId = filters[Models.Application.loadedAppModels[appId][mdl].belongsTo[rel].parentModel+'_id'];
							if (parentModelId !== undefined) {
								var parentModel = Models.Application.loadedAppModels[appId][mdl].belongsTo[rel].parentModel;

								Models.Model.lookup(mdl, appId, context, filters.user, {model: parentModel, id: parentModelId}, function(err, results) {
									if (!results) {
										callback(err, results);
									} else {
										results = results.slice(0, 10);

										Models.Model.multiGet(mdl, results, appId, context, callback);
									}
								});
							}
						}
					} else {
						Models.Model.getAll(mdl, appId, context, function(err, results) {
							if (err) return callback(err, null);

							if(!id) {
								if (filters) {
									for (var rel in Models.Application.loadedAppModels[appId][mdl].belongsTo) {
										var parentModelId = filters[Models.Application.loadedAppModels[appId][mdl].belongsTo[rel].parentModel+'_id'];
										if (parentModelId !== undefined) {
											var parentModel = Models.Application.loadedAppModels[appId][mdl].belongsTo[rel].parentModel;

											Models.Model.lookup(mdl, appId, context, filters.user, {model: parentModel, id: parentModelId}, function(err, results) {
												if (!results) {
													callback(err, results);
												} else {
													results = results.slice(0, 10);

													Models.Model.multiGet(mdl, results, appId, context, callback);
												}
											});
										}
									}
								} else {
									Models.Model.getAll(mdl, appId, context, callback);
								}
							} else {
								new Models.Model(mdl, appId, id, context, function(err, results) {
									if (err) return callback(err, null);

									var message = {};
									message[id] = results.value;

									callback(null, message);
								});
							}
						});
					}
				} else {
					new Models.Model(mdl, appId, id, context, function(err, results) {
						if (err) return callback(err, null);

						var message = {};
						message[id] = results.value;

						callback(null, message)
					});
				}
			},
			function(results, callback) {
				app.kafkaProducer.send([{
					topic: 'track',
					messages: [JSON.stringify({
						op: 'sub',
						object: {id: id, context: context, device_id: deviceId, user_id: userId, filters: filters},
						applicationId: req.get('X-BLGREQ-APPID')
					})],
					attributes: 0
				}], function(err, data) {
					if (err) return callback(err, null);

					callback(err, results);
				});
			}
		], function(err, result) {
			if (err)
				return next(err);

			res.json({status: 200, message: result}).end();
		});
	}
});

router.post('/unsubscribe', function(req, res, next) {
	var id = req.body.id;
	var context = req.body.context;
	var deviceId = req.body.device_id;
	var filters = req.body.filters;
	var mdl = req.body.model;
	var appId = req.get('X-BLGREQ-APPID');

	if (!context)
		res.status(400).json({status: 400, message: "Requested context is not provided."}).end();
	else {
		async.waterfall([
			function(callback) {
				Models.Subscription.remove(context, deviceId, {model: Models.Application.loadedAppModels[appId][mdl].namespace, id: id}, filters, function(err, results) {
					if (err && err.code == cb.errors.keyNotFound) {
						var error = new Error('Subscription not found');
						error.status = 404;

						callback(error, null);
					}	else if (err)
						callback(err, null);
					else
						callback(null, {status: 200, message: "Subscription removed"});
				});
			},
			function(result, callback) {
				app.kafkaProducer.send([{
					topic: 'track',
					messages: [JSON.stringify({
						op: 'unsub',
						object: {id: id, context: context, device_id: deviceId, filters: filters},
						applicationId: req.get('X-BLGREQ-APPID')
					})],
					attributes: 0
				}], function(err, data) {
					if (err) return callback(err, null);

					callback(err, result);
				});
			}
		], function(err, results) {
			if (err) return next(err);

			res.status(results.status).json(results).end();
		});
	}
});

router.post('/create', function(req, res, next) {
	var content = req.body.content;
	var mdl = req.body.model;

	content.type = mdl;
	content.context_id = req.body.context;

	async.series([
		function(agg_callback) {
			app.kafkaProducer.send([{
				topic: 'aggregation',
				messages: [JSON.stringify({
					op: 'add',
					object: content,
					applicationId: req.get('X-BLGREQ-APPID')
				})],
				attributes: 0
			}], agg_callback);
		},
		function(track_callback) {
			app.kafkaProducer.send([{
				topic: 'track',
				messages: [JSON.stringify({
					op: 'add',
					object: content,
					applicationId: req.get('X-BLGREQ-APPID')
				})],
				attributes: 0
			}], track_callback);
		}
	], function(err, results) {
		if (err) return next(err);

		res.status(201).json({status: 201, message: 'Created'}).end();
	});
});

router.post('/update', function(req, res, next) {
	var context = req.body.context;
	var patch = req.body.patch;
	var id = req.body.id;
	var mdl = req.body.model;

	if (! (patch instanceof Array)) {
		var error = new Error('Patch must be an array');
		error.status = 400;

		return next(error);
	}

	async.series([
		function(agg_callback) {
			app.kafkaProducer.send([{
				topic: 'aggregation',
				messages: [JSON.stringify({
					op: 'edit',
					id: id,
					context: context,
					object: patch,
					type: mdl,
					applicationId: req.get('X-BLGREQ-APPID')
				})],
				attributes: 1
			}], agg_callback);
		},
		function(track_callback) {
			app.kafkaProducer.send([{
				topic: 'track',
				messages: [JSON.stringify({
					op: 'edit',
					id: id,
					context: context,
					object: patch,
					type: mdl,
					applicationId: req.get('X-BLGREQ-APPID')
				})],
				attributes: 1
			}], track_callback);
		}
	], function(err, results) {
		if (err) return next(err);

		res.status(200).json({status: 200, message: 'Updated'}).end();
	});
});

router.post('/delete', function(req, res, next) {
	var id = req.body.id;
	var context = req.body.context;
	var mdl = req.body.model;

	async.series([
		function(agg_callback) {
			app.kafkaProducer.send([{
				topic: 'aggregation',
				messages: [JSON.stringify({
					op: 'delete',
					object: {id: id, type: mdl, context: context},
					applicationId: req.get('X-BLGREQ-APPID')
				})],
				attributes: 1
			}], agg_callback);
		},
		function(track_callback) {
			app.kafkaProducer.send([{
				topic: 'track',
				messages: [JSON.stringify({
					op: 'delete',
					object: {op: 'remove', path: mdl+'/'+id},
					applicationId: req.get('X-BLGREQ-APPID')
				})],
				attributes: 1
			}], track_callback);
		}
	], function(err, results) {
		if (err) return next(err);

		res.status(200).json({status: 200, message: 'Deleted'}).end();
	});
});

module.exports = router;
