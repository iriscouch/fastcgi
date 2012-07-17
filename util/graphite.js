#!/usr/bin/env node
//
// Hit an FCGI Graphite/Django server.

var fs = require('fs')
var util = require('util')
var request = require('request')

var base = 'http://localhost:8888'
  , paths = [ '/', '/browser/header/', '/composer/?', '/content/img/graphite_short.png'
            , '/content/js/ext/resources/css/ext-all.css' , '/content/js/ext/ext-all-debug.js'
            , '/content/js/ext/adapter/ext/ext-base-debug.js'
            , '/content/js/browser.js', '/content/js/composer_widgets.js' , '/content/js/composer.js', '/content/js/completer.js'
            ]

var max_runs = +(process.argv[2] || 50)
  , runs = []
  , results = {}

console.log('Testing %d runs', max_runs)
for(var i = 0; i < max_runs; i++)
  //setTimeout(run, 500 * i, i)
  run(i)

function run(run_number) {
  var path = paths[Math.floor(Math.random() * paths.length)]
    , url = base + path

  var req = request.get({'url':url, 'encoding':null}, on_response)
  req.on('error', function(er) {
    console.log('Request error for %s: %s', path, er.message)
    throw er
  })

  function on_response(er, res) {
    if(er) {
      console.log('Fail: %s', path)
      throw er
    }

    if(res.statusCode != 200)
      throw new Error('Bad status for run '+run_number+': ' + res.statusCode)

    //console.log('Response: %s', util.inspect(res.body))
    var cached_result = results[path]
    if(!cached_result) {
      console.log('ok %s (%d)', path, res.body.length)
      results[path] = {'run':run_number, 'body':res.body}
    }

    else {
      var diff_at = buf_diff(cached_result.body, res.body)
      if(diff_at !== null) {
        console.log('Body of %s changed at %d from run %d to %d', path, diff_at, cached_result.run, run_number)
        var cached_arr = buf_array(cached_result.body)
          , run_arr    = buf_array(res.body)

        console.log('  %d (%d): %j', cached_result.run, cached_result.body.length, cached_arr)
        console.log('')
        console.log('  %d (%d): %j', run_number, res.body.length, run_arr)

        fs.writeFileSync('cached.out', cached_result.body)
        fs.writeFileSync('run.out', res.body)

        throw new Error('not ok ' + path)
      }

      else
        console.log('ok %s (same)', path)
    }
  }
}

function buf_diff(a, b) {
  for(var i = 0; i < a.length; i++)
    if(a[i] != b[i])
      return i

  if(a.length != b.length)
    return i

  return null
}

function buf_array(buf) {
  var result = []
  for (var i = 0; i < buf.length; i++)
    result.push(buf[i])
  return result
}
