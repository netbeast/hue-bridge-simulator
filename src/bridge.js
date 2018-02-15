const express = require('express')
const {announceBridge} = require('../src/upnp.js')
const app = express()
const fs = require('fs')
const morgan = require('morgan')
const bodyParser = require('body-parser')
const CronJob = require('cron').CronJob
const request = require('request')
const path = require('path')

// eslint-disable-next-line no-extend-native
Date.prototype.isValid = function () {
  return isFinite(this)
}

// eslint-disable-next-line no-extend-native
Date.prototype.isPast = function () {
  return this < new Date()
}

// eslint-disable-next-line no-extend-native
Date.prototype.toHueDateTimeFormat = function () {
  return this.isValid() ? this.toJSON().substr(0, 19) : 'invalid date'
}

function allowCrossDomain (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  // what about X-Requested-With, X-HTTP-Method-Override, Accept ?

  if (req.method === 'OPTIONS') {
    res.end()
  } else {
    next()
  }
}

function whitelist (req, res, next) {
  if (req && req.params && req.params.hasOwnProperty('username')) {
    const username = req.params.username
    if (app.get('state').config.whitelist.hasOwnProperty(username)) {
      req.username = username
      return next()
    }
  }

  return res.json([
    {
      error: {
        type: 1,
        address: '/',
        description: 'unauthorized user',
      },
    },
  ])
}

app.use(morgan('tiny'))
app.use(express.static(path.join(__dirname, '../public_html')))
app.use(bodyParser.json())
app.use(allowCrossDomain)

app.set('state', require('./initialState'))

app.get('/', function (req, res) {
  res.redirect(301, 'index.html')
})

app.get('/linkbutton', function (request, response) {
  app.get('state').config.linkbutton = true
  setTimeout(function () {
    app.get('state').config.linkbutton = false
  }, 30000)
  response.send(
    200,
    'link button pushed. you have 30 seconds to register new usernames'
  )
})

// -- Lights API

// get all lights
app.get('/api/:username/lights', whitelist, function (req, res) {
  // get light state
  const lights = app.get('state').lights
  res.json(200, lights)
})

let mapObject = function (obj, fn) {
  let result = {}
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[key] = fn(obj[key])
    }
  }
  return result
}

let selectSubsetFromJSON = function (json, keys) {
  let result = {}
  // cast 'keys' to array
  if (typeof keys !== 'object') {
    keys = [keys]
  }
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = json[keys[i]]
  }
  return result
}

// get new lights TODO
app.get('/api/:username/lights/new', whitelist, function (req, res) {
  res.json({
    '7': {
      name: 'Hue Lamp 7',
    },
    '8': {
      name: 'Hue Lamp 8',
    },
    lastscan: '2012-10-29T12:00:00',
  })
})

// search for new lights TODO
// accept a new light object and add it to lights list
// since this isn't a real feature of the Hue bridge API, didn't modify the return value
app.post('/api/:username/lights', whitelist, function (req, res) {
  if (req.body && req.body.length > 0) {
    // figure out next index
    const numKeys = Object.keys(app.get('state').lights).length
    // Clone one of the existing objects as a placeholder at the new index
    app.get('state').lights[numKeys + 1] = JSON.parse(
      JSON.stringify(app.get('state').lights[1])
    )
    let newLight = app.get('state').lights[numKeys + 1]
    // update name
    if (req.body.name) {
      newLight.name = req.body.name
    }
    // update state
    updateProperties(newLight.state, req.body.state, null)
  }
  res.json([{success: {'/lights': 'Searching for new devices'}}])
})

// get light
app.get('/api/:username/lights/:id', whitelist, function (req, res) {
  let id = req.params.id
  res.json(app.get('state').lights[id])
})

// rename light
app.put('/api/:username/lights/:id', whitelist, function (req, res) {
  let name = req.body.name
  let id = req.params.id
  app.get('state').lights[id]['name'] = name
  let success = {}
  success['/lights/' + id + '/name'] = name
  res.json([{success: success}])
})

// change light state
app.put('/api/:username/lights/:id/state', whitelist, function (req, res) {
  let id = req.params.id
  let state = app.get('state').lights[id].state
  let response = updateProperties(state, req.body, '/lights/' + id + '/state/')
  res.json(response)
})

let updateProperties = function (obj, props, successPath) {
  let response = []
  for (let propertyToBeUpdated in props) {
    if (props.hasOwnProperty(propertyToBeUpdated)) {
      if (obj.hasOwnProperty(propertyToBeUpdated)) {
        let newValue = props[propertyToBeUpdated]
        obj[propertyToBeUpdated] = newValue
        // TODO: currently all values are treated as string ! this could lead to bugs and has to be fixed
        if (successPath) {
          let success = {}
          success[successPath + propertyToBeUpdated] = newValue
          response.push({
            success: success,
          })
        }
      }
    }
  }
  return response
}

// -- Groups API

app.get('/api/:username/groups', whitelist, function (req, res) {
  const groups = app.get('state').groups
  // Only send names of lights
  const result = mapObject(groups, function (group) {
    return selectSubsetFromJSON(group, 'name')
  })
  res.json(result)
})

// get group attributes
app.get('/api/:username/groups/:id', whitelist, function (req, res) {
  const id = req.params.id
  res.json(app.get('state').groups[id])
})

// set group attributes
app.put('/api/:username/groups/:id', whitelist, function (req, res) {
  let id = req.params.id
  let name = req.body.name
  let lights = req.body.lights
  let group = app.get('state').groups[id]
  let result = []
  let success = {}

  if (name) {
    group.name = name
    success['/groups/' + id + '/name'] = name
    result.push({success: success})
  }

  if (lights) {
    group.lights = lights
    success['/groups/' + id + '/lights'] = lights
    result.push({success: success})
  }

  res.json(result)
})

// set group state
app.put('/api/:username/groups/:id/action', whitelist, function (req, res) {
  let id = req.params.id
  let action = req.body
  let group = app.get('state').groups[id]

  let lights = []
  if (id === '0') {
    for (const lightId in app.get('state').lights) {
      lights.push(lightId)
    }
  } else {
    if (group) {
      lights = group.lights
      group.action = action
    } else {
      // error TODO proper handling
      console.error('no group found')
    }
  }

  for (let i = 0; i < lights.length; i++) {
    let lightId = lights[i]
    let lightState = app.get('state').lights[lightId].state
    updateProperties(lightState, action)
  }

  let result = []
  for (let property in action) {
    let success = {}
    success['/groups/' + id + '/action/' + property] = action[property]
    result.push({success: success})
  }

  res.json(result)
})

// -- Schedules API

// Returns a list of all schedules in the system. Each group has a name and unique identification number.
// If there are no schedules then the bridge will return an empty object, {}.
app.get('/api/:username/schedules', whitelist, function (req, res) {
  let result = mapObject(app.get('state').schedules, function (schedule) {
    return selectSubsetFromJSON(schedule, 'name')
  })
  res.json(result)
})

function nextScheduleId () {
  let id = 1
  while (app.get('state').schedules[id]) id++
  return id
}

function scheduleNameExists (name) {
  for (let scheduleId in app.get('state').schedules) {
    let schedule = app.get('state').schedules[scheduleId]
    if (schedule.name === name) return true
  }
  return false
}

function nextScheduleName () {
  let name = 'schedule' // default name for schedules
  let number = 1
  while (scheduleNameExists(name)) {
    name = 'schedule ' + number++
  }
  return name
}

let scheduleCronJobs = {}

function createSchedule (id, schedule) {
  app.get('state').schedules[id] = schedule
  scheduleCronJobs[id] = new CronJob(
    new Date(schedule.time),
    function onTickSchedule () {
      console.log(
        'schedule ' +
          id +
          ' executing command: ' +
          JSON.stringify(schedule.command)
      )
      request(
        {
          uri:
            'http://127.0.0.1:' +
            (process.env.PORT || 80) +
            schedule.command.address,
          method: schedule.command.method,
          body: JSON.stringify(schedule.command.body),
        },
        function (error, res, body) {
          if (!error && res.statusCode === 200) {
            console.log(body)
          } else {
            console.log(error)
          }
        }
      )
      this.stop()
    },
    function onCompleteSchedule () {
      // on complete or stop: remove the schedule and the cronjob
      delete scheduleCronJobs[id]
      delete app.get('state').schedules[id]
      console.log('schedule ' + id + ' removed.')
    },
    true // start job directly
  )
}

function deleteSchedule (id) {
  let job = scheduleCronJobs[id]
  if (job) {
    job.stop()
  }
}

// create schedule (real bridge can save up to 100)
app.post('/api/:username/schedules', whitelist, function (req, res) {
  // parameter time and command are required
  if (!req.body.time || !req.body.command) {
    return res.json([
      {
        error: {
          type: 5,
          address: '/schedules',
          description: 'invalid/missing parameters in body',
        },
      },
    ])
  }

  // bridge time is measured in UTC
  const date = new Date(req.body.time)
  if (!date.isValid() || date.isPast()) {
    // invalid date and dates in the past raise error 7
    return res.json([
      {
        error: {
          type: 7,
          address: '/schedules/time',
          description:
            'invalid value, ' + req.body.time + ', for parameter, time',
        },
      },
    ])
  }

  // parameters are limited to different number of characters, those errors are not yet raised in the simulator
  let name = req.body.name || nextScheduleName()
  let description = req.body.description || ''
  let command = req.body.command
  let time = req.body.time
  let id = nextScheduleId()
  let created = new Date().toHueDateTimeFormat()
  let schedule = {
    name: name,
    description: description,
    command: command,
    time: time,
    created: created,
    status: 'enabled',
  }

  createSchedule(id, schedule)

  // output
  return res.json([
    {
      success: {id: id.toString()},
    },
  ])
})

// get schedule attributes
app.get('/api/:username/schedules/:id', whitelist, function (req, res) {
  const id = req.params.id
  const schedule = app.get('state').schedules[id]
  if (!schedule) {
    // todo: duplicate code -> try to understand how bridge error handler works and do it abstract
    // error 3 seems to be 'resource x not available' error
    res.json([
      {
        error: {
          type: 3,
          address: '/schedules/' + id,
          description: 'resource, /schedules/' + id + ', not available',
        },
      },
    ])
  } else {
    res.json(schedule)
  }
})

// set schedule attributes
app.put('/api/:username/schedules/:id', whitelist, function (req, res) {
  let id = req.params.id
  if (!app.get('state').schedules[id]) {
    return res.json([
      {
        error: {
          type: 704,
          address: '/schedules/' + id,
          description:
            'Cannot create schedule because tag, ' + id + ', is invalid.',
        },
      },
    ])
  }

  if (req.body.time) {
    let date = new Date(req.body.time)
    if (!date.isValid() || date.isPast()) {
      // invalid date and dates in the past raise error 7
      return res.json([
        {
          error: {
            type: 7,
            address: '/schedules/time',
            description:
              'invalid value, ' + req.body.time + ', for parameter, time',
          },
        },
      ])
    }
  }

  const schedule = app.get('state').schedules[id]
  schedule.created = new Date().toHueDateTimeFormat()
  let result = updateProperties(schedule, req.body, '/schedules/' + id + '/')
  deleteSchedule(id)
  createSchedule(id, schedule)
  res.json(result)
})

// delete schedule
app.delete('/api/:username/schedules/:id', whitelist, function (req, res) {
  const id = req.params.id

  if (app.get('state').schedules[id]) {
    deleteSchedule(id)
    return res.json([{success: '/schedules/' + id + ' deleted.'}])
  }

  res.json([
    {
      error: {
        type: 3,
        address: '/schedules/' + id,
        description: 'resource, /schedules/' + id + ', not available',
      },
    },
  ])
})

/*
// create initial test schedule which turns all lights on in 2 seconds
createSchedule(1, {
    "name": "schedule",
    "description": "",
    "command": {
        "address": "/api/newdeveloper/groups/0/action",
        "body": {
            "on": true
        },
        "method": "PUT"
    },
    "time": new Date(new Date().valueOf()+2000).toHueDateTimeFormat(),
    "created": new Date().toHueDateTimeFormat(),
    "status": "enabled"
});
*/

// -- Configuration API

// create user
app.post('/api', function (req, res) {
  const devicetype = req.body.devicetype
  let username = req.body.username

  if (!username) {
    username = 'letmegeneratethatforyou'
  }

  if (app.get('state').config.linkbutton) {
    app.get('state').config.whitelist[username] = {
      'last use date': '2012-10-29T12:00:00',
      'create date': '2012-10-29T12:00:00',
      name: devicetype,
    }
    return res.json([
      {
        success: {
          username: username,
        },
      },
    ])
  }

  res.json([
    {
      error: {
        type: 101,
        address: '',
        description: 'link button not pressed',
      },
    },
  ])
})

// get config
app.get('/api/:username/config', function (req, res) {
  // config does not give unauthorized_user error, but a public part of the config
  if (req && req.params && req.params.hasOwnProperty('username')) {
    const username = req.params.username
    if (app.get('state').config.whitelist.hasOwnProperty(username)) {
      return res.json(app.get('state').config)
    }
  }

  // only send name and swversion if the user is not authed
  res.json(selectSubsetFromJSON(app.get('state').config, ['name', 'swversion']))
})

// change config
app.put('/api/:username/config', whitelist, function (req, res) {
  const result = updateProperties(app.get('state').config, req.body, '/config/')
  res.json(result)
})

// delete user
app.delete(
  '/api/:username/config/whitelist/:userToBeDeleted',
  whitelist,
  function (req, res) {
    const deleteUsername = req.params.userToBeDeleted
    delete app.get('state').config.whitelist[deleteUsername]
    res.json([{success: '/config/whitelist/' + deleteUsername + ' deleted.'}])
  }
)

// get full state
app.get('/api/:username', whitelist, function (req, res) {
  res.json(app.get('state'))
})

app.use('/api/:username/sensors', (req, res) => res.json({status: 'ok'}))

app.get('/description.xml', function (req, res) {
  fs.readFile(
    path.join(__dirname, '/description.xml'),
    {encoding: 'utf8'},
    function (err, data) {
      if (err) res.status(500).json(err)

      let address = app._server.address()
      if (address.address === '0.0.0.0') {
        // bound to all interfaces, just return the host that the request came in on
        address.address = request.headers.host
      }

      data = data
        .replace(/\{\{IP\}\}/g, address.address)
        .replace(/\{\{PORT\}\}/g, address.port)

      res.header('Content-Type', 'application/xml; charset=UTF-8')
      res.send(data)
    }
  )
})

function localAddress () {
  const os = require('os')
  const ifaces = os.networkInterfaces()
  const addresses = []
  for (const dev in ifaces) {
    ifaces[dev].forEach(function (details) {
      if (details.family === 'IPv4' && details.internal === false) {
        addresses.push(details.address)
      }
    })
  }
  return addresses.length === 0 ? null : addresses[0]
}

app.run = function (options) {
  const serverAddress = `${options.hostname || localAddress()}:${options.port}`

  // save server reference for use in route "/description.xml"
  app._server = app.listen(
    options.port,
    options.hostname,
    options.backlog,
    function () {
      console.log(`hue simulator listening @ ${serverAddress}`)
      announceBridge({
        location: `http://${serverAddress}`,
      })
    }
  )
}

module.exports = app
