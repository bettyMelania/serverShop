import Koa from 'koa';
import cors from 'koa-cors';
import convert from 'koa-convert';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import http from 'http';
import socketIo from 'socket.io';
import dataStore from 'nedb-promise';
import {getLogger, timingLogger, errorHandler, jwtConfig} from './utils';
import {ProductRouter} from './product-router';
import {AuthRouter} from './auth-router';
import koaJwt from 'koa-jwt';
import socketioJwt from 'socketio-jwt';

const app = new Koa();
const router = new Router();
const server = http.createServer(app.callback());
const io = socketIo(server);
const log = getLogger('app');

app.use(timingLogger);
app.use(errorHandler);

app.use(bodyParser());
app.use(convert(cors()));

const apiUrl = '/api';

log('config public routes');
const authApi = new Router({prefix: apiUrl})
const userStore = dataStore({filename: '../users.json', autoload: true});
authApi.use('/auth', new AuthRouter({userStore, io}).routes())
app.use(authApi.routes()).use(authApi.allowedMethods())

log('config protected routes');
app.use(convert(koaJwt(jwtConfig)));
const protectedApi = new Router({prefix: apiUrl})
const productStore = dataStore({filename: '../products.json', autoload: true});
const productRouter=new ProductRouter({productStore, io});
protectedApi.use('/product',productRouter.routes())
app.use(protectedApi.routes()).use(protectedApi.allowedMethods());

io.on('connection', socketioJwt.authorize(jwtConfig))
  .on('authenticated', (socket) => {
    const username = socket.decoded_token.username;
    socket.join('${username}');
	productRouter.setSocket(socket);
    log(`${username} authenticated and joined`);
    socket.on('disconnect', () => {
      log(`${username} disconnected`);
    })
  });

(async() => {
  log('ensure default data');
  const ensureUserAndProducts = async(username) => {
    let user = await userStore.findOne({username: username});
    if (user) {
      log(`user ${username}`);
    } else {
      user = await userStore.insert({username, password: username});
      log(`user added ${JSON.stringify(user)}`);
    }
    let products = await productStore.find({user: user._id});
    if (products.length >= 10) {
      log(`user ${username} had ${products.length} products`);
    } else {
      for (let i = 0; i < 10; i++) {
        let product = await productStore.insert({
          id:`${i}`,
          name: `Products ${username}${i}`,
          amount:2*`${i}`,
          price: 3*`${i}`,
          updated: Date.now(),
          user: user._id,
          version: 1
        });
        log(`product added ${JSON.stringify(product)}`);
      }
    }
  };
  await Promise.all(['betty', 'bea'].map(username => ensureUserAndProducts(username)));
})();

server.listen(3000);