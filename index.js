// Environment required
if (!process.env.SERVER_DID || !process.env.SERVER_PRIVATE_KEY || !process.env.TMP_DID) {
  throw new Error("Faltan las variables de entorno SERVER_DID y SERVER_PRIVATE_KEY")
}


const express = require('express')
const bodyParser = require('body-parser')
const ngrok = require('ngrok')
const decodeJWT = require('did-jwt').decodeJWT
const { Credentials } = require('uport-credentials')
const transports = require('uport-transports').transport
const message = require('uport-transports').message.util
const randomstring = require('randomstring')

const { success, fail, error } = require('./Utils')

const app = express();

let endpoint = null
let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8090

app.use(bodyParser.json({ type: '*/*' }))
//setup Credentials object with newly created application identity.

let codes = []
const credentials = new Credentials({
  appName: 'Request Verification Example',
  did: process.env.SERVER_DID,
  privateKey: process.env.SERVER_PRIVATE_KEY
})

app.use("/", express.static(__dirname + '/public'));
app.get('/api/disclosure', (req, res) => {
  let url = endpoint !== null ? endpoint : 'http://' + req.hostname  + ':' + port
  let code = randomstring.generate();

  console.log('callback host', url)
  credentials.createDisclosureRequest({
    verified: ['didiserver'],
    callbackUrl: url + '/api/callback/' + code
  }).then(requestToken => {
    console.log(decodeJWT(requestToken))  //log request token to console
    const uri = message.paramsToQueryString(message.messageToURI(requestToken), {callback_type: 'post'})
    const qr =  transports.ui.getImageDataURI(uri)
    codes.push({ code, status: false })
    success(res, { code, qr })
  }).catch(e => {
    console.error(e)
    error(res, 'Error interno')
  })
})

app.get('/api/check/:code', (req, res) => {
  let value = codes.find(c => c.code === req.params.code)
  success(res, value ? value.status : false)
})

app.post('/api/callback/:code', (req, res) => {
  const code = req.params.code
  const jwt = req.body.access_token
  console.log('[JWT]', jwt)
  console.log('[JWT decode]', decodeJWT(jwt))
  credentials.authenticateDisclosureResponse(jwt).then(creds => {
    //validate specific data per use case
    console.log('[credencial]', creds)
    //console.log(creds.verified[0])
    codes = [...codes.filter(c => c.code !== code), { code, jwt, status: true }]
    success(res, creds)
  }).catch( err => {
    console.log(err)
    error(res, 'Error interno')
  })
})

app.get('/api/credential/:code', (req, res) => {
  const code = req.params.code
  let data = codes.find(c => c.code === code)

  if (!data) {
    return fail(res, 'El codigo no existe')
  }

  let decode = decodeJWT(data.jwt)
  console.log('[decode]', decode)
  //TODO falta la validacion del issuer
  if (decode.payload.aud !== process.env.TMP_DID) {
    return fail(res, 'El issuer no es valido')
  }

  let reply = {
    //didiserver: decode.payload.own.didiserver,
    didiserver: decode.payload.own.didiserver.didiserver,
    iss: decode.payload.iss
  }
  success(res, reply)
})


// run the app server and tunneling service
app.listen(port, () => {
  if (process.env.DISABLE_NGROK) {
    console.log('Verification Service running, no NGROK')
  } else {
    ngrok.connect(port).then(ngrokUrl => {
      endpoint = ngrokUrl
      console.log(`Verification Service running, open at ${ngrokUrl}`)
    })
  }
})