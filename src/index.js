const cors = require('cors');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const expressWinston = require('express-winston');
const helmet = require('helmet');
const { createProxyMiddleware } = require('http-proxy-middleware');
const responseTime = require('response-time');
const winston = require('winston');
const config = require('./config');
const { readFileSync } = require('fs');
const https = require('https');

const credentials = {
  key: readFileSync(__dirname + '/cert/server.key'),
  cert: readFileSync(__dirname + '/cert/server.crt'),
};

const app = express();
const port = config.serverPort;
const secret = config.sessionSecret;
const store = new session.MemoryStore();

app.use(
  '/search',
  createProxyMiddleware({
    target: 'http://api.duckduckgo.com/',
    changeOrigin: true,
    pathRewrite: {
      [`^/search`]: '',
    },
  })
);

app.use(cors());
app.use(helmet());

app.use(rateLimit(config.rate));

app.use(responseTime());

app.use(
  expressWinston.logger({
    transports: [new winston.transports.Console()],
    format: winston.format.json(),
    statusLevels: true,
    meta: false,
    msg: 'HTTP {{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms',
    expressFormat: true,
    ignoreRoute() {
      return false;
    },
  })
);

const protect = (req, res, next) => {
  const { authenticated } = req.session;

  if (!authenticated) {
    res.sendStatus(401);
  }

  next();
};

app.use(
  session({
    secret,
    resave: false,
    saveUninitialized: true,
    store,
  })
);

app.get('/login', (req, res) => {
  const { authenticated } = req.session;

  if (!authenticated) {
    req.session.authenticated = true;
    res.send('Successfully authenticated');
  } else {
    res.send('Already authenticated');
  }
});

app.get('/protected', protect, (req, res) => {
  const { name = 'user' } = req.query;
  res.send(`Hello ${name}!`);
});

Object.keys(config.proxies).forEach((path) => {
  const { protected, ...options } = config.proxies[path];
  const check = protected ? protect : alwaysAllow;
  app.use(path, check, createProxyMiddleware(options));
});

app.get('/logout', protect, (req, res) => {
  req.session.destroy(() => {
    res.send('Successfully logged out');
  });
});

https
  .createServer(credentials, app)
  .listen(port, () => console.log(`Server is running at port ${port}`));
