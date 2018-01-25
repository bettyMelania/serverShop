import {
  OK, NOT_FOUND, LAST_MODIFIED, NOT_MODIFIED, BAD_REQUEST, ETAG,
  CONFLICT, METHOD_NOT_ALLOWED, NO_CONTENT, CREATED, FORBIDDEN, setIssueRes
} from './utils';
import Router from 'koa-router';
import {getLogger} from './utils';

const log = getLogger('product');

let productsLastUpdateMillis = null;

export class ProductRouter extends Router {
  constructor(props) {
    super(props);
    this.productStore = props.productStore;
    this.get('/', async(ctx) => {
      let res = ctx.response;
      let lastModified = ctx.request.get(LAST_MODIFIED);
      if (lastModified && productsLastUpdateMillis && productsLastUpdateMillis <= new Date(lastModified).getTime()) {
        log('search / - 304 Not Modified');
        res.status = NOT_MODIFIED;
      } else {
        res.body = await this.productStore.find({user: ctx.state.user._id});
        if (!productsLastUpdateMillis) {
            productsLastUpdateMillis = Date.now();
        }
        res.set({[LAST_MODIFIED]: new Date(productsLastUpdateMillis)});
        log('search / - 200 Ok');
      }
    }).get('/:id', async(ctx) => {
        log( this.productStore);
      let product = await this.productStore.findOne({id: ctx.params.id});
      let res = ctx.response;
      if (product) {
        if (product.user == ctx.state.user._id) {
          log('read /:id - 200 Ok');
          this.setProductRes(res, OK, product); //200 Ok
        } else {
          log('read /:id - 403 Forbidden');
          setIssueRes(res, FORBIDDEN, [{error: "It's not your product"}]);
        }
      } else {
        log('read /:id - 404 Not Found ');
        setIssueRes(res, NOT_FOUND, [{warning: 'Product not found'}]);
      }
    }).post('/', async(ctx) => {
      let product = ctx.request.body;
      let res = ctx.response;
      if (product.name) { //validation
          product.user = ctx.state.user._id;
        await this.createProduct(ctx, res, product);
      } else {
        log(`create / - 400 Bad Request`);
        setIssueRes(res, BAD_REQUEST, [{error: 'Text is missing'}]);
      }
    }).put('/:id', async(ctx) => {
      let product = ctx.request.body;
      let id = ctx.params.id;
      let productId = product.id;
      let res = ctx.response;
     if (productId && productId != id) {
        log(`update /:id - 400 Bad Request (param id and body _id should be the same)`);
        setIssueRes(res, BAD_REQUEST, [{error: 'Param id and body _id should be the same'}]);
        return;
      }
      if (!product.name) {
        log(`update /:id - 400 Bad Request (validation errors)`);
        setIssueRes(res, BAD_REQUEST, [{error: 'Name is missing'}]);
        return;
      }
      if (!productId) {
        await this.createProduct(ctx, res, product);
      } else {
        let persistedProduct = await this.productStore.findOne({id: product.id});
        if (persistedProduct) {
          if (persistedProduct.user != ctx.state.user._id) {
            log('update /:id - 403 Forbidden');
            setIssueRes(res, FORBIDDEN, [{error: "It's not your product"}]);
            return;
          }
          let productVersion = parseInt(ctx.request.get(ETAG)) || product.version;
          if (!productVersion) {
            log(`update /:id - 400 Bad Request (no version specified)`);
            setIssueRes(res, BAD_REQUEST, [{error: 'No version specified'}]); //400 Bad Request
          } else if (productVersion < persistedProduct.version) {
            log(`update /:id - 409 Conflict`);
            setIssueRes(res, CONFLICT, [{error: 'Version conflict'}]); //409 Conflict
          } else {
              product.version = productVersion + 1;
              product.updated = Date.now();
			  await this.productStore.remove({_id: product._id});
			  await this.productStore.insert(product);
              productsLastUpdateMillis = product.updated;
              this.setProductRes(res, OK, product); //200 Ok
              this.io.emit('product/updated', product);
              log(` emit product/updated }`)
          }
        } else {
          log(`update /:id - 405 Method Not Allowed (resource no longer exists)`);
          setIssueRes(res, METHOD_NOT_ALLOWED, [{error: 'product no longer exists'}]); //Method Not Allowed
        }
      }
    }).del('/:id', async(ctx) => {
      let id = ctx.params.id;
      await this.productStore.remove({_id: id, user: ctx.state.user._id});
      this.io.to(ctx.state.user.username).emit('product/deleted', {_id: id})
        productsLastUpdateMillis = Date.now();
      ctx.response.status = NO_CONTENT;
      log(`remove /:id - 204 No content (even if the resource was already deleted), or 200 Ok`);
    });
  }

  async createProduct(ctx, res, product) {
      product.version = 1;
      product.updated = Date.now();
    let insertedProduct = await this.productStore.insert(product);
      productsLastUpdateMillis = product.updated;
    this.setProductRes(res, CREATED, insertedProduct); //201 Created
    this.io.emit('product/created', insertedProduct);
	log(` emit product/creted }`)
  }
  setSocket(socket){
	this.io=socket;
  }

  setProductRes(res, status, product) {
    res.body = product;
    res.set({
      [ETAG]: product.version,
      [LAST_MODIFIED]: new Date(product.updated)
    });
    res.status = status; //200 Ok or 201 Created
  }
}
