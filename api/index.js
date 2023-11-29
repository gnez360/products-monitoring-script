"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = __importDefault(require("cheerio"));
const fs_1 = __importDefault(require("fs"));
const moment_1 = __importDefault(require("moment"));
const https_1 = __importDefault(require("https"));
const intl_1 = __importDefault(require("intl"));
const node_cron_1 = __importDefault(require("node-cron"));
const uuid_1 = require("uuid");
moment_1.default.locale('pt-BR');
const OLX_URL = 'https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios/hyundai/i30/estado-mg/belo-horizonte-e-regiao?sf=1';
const SEMINOVOS_BASE_URL = 'https://seminovos.com.br/carro/hyundai/i30';
const MAX_PAGES = 5;
const TOKEN = 'dGVzdGVhMjU6NjEyRFNXb1VPZjhvVjFxbUtjSlE=';
const ENDPOINT = 'https://guilherme-nery-c5a2b.http.msging.net/messages';
class ProductScraper {
    constructor() {
        this.productList = [];
        this.id = this.generateGUID();
        this.to = '332422729@telegram.gw.msging.net';
        this.type = 'text/plain';
        this.token = TOKEN;
        this.endpoint = ENDPOINT;
        node_cron_1.default.schedule('*/1 * * * *', async () => {
            console.log('Executing the scraper...');
            await this.execute();
        });
    }
    generateGUID() {
        return (0, uuid_1.v4)();
    }
    async sendMessage(content) {
        const data = {
            id: this.id,
            to: this.to,
            type: this.type,
            content: content,
        };
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${this.token}`,
            },
        };
        try {
            const axiosInstance = this.createAxiosInstance();
            await axiosInstance.post(this.endpoint, data, config);
            console.log('Mensagem Enviada', content);
        }
        catch (error) {
            console.error('Erro na requisição:', error);
        }
    }
    createAxiosInstance() {
        return axios_1.default.create({
            httpsAgent: new https_1.default.Agent({
                rejectUnauthorized: false
            })
        });
    }
    async fetchHTML(url) {
        try {
            const axiosInstance = this.createAxiosInstance();
            const headers = {
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,sm;q=0.6',
                'User-Agent': 'PostmanRuntime/7.34.0',
                'Host': 'olx.com.br'
            };
            const response = await axiosInstance.get(url, { headers });
            return response.data;
        }
        catch (error) {
            throw new Error(`Error fetching HTML: ${error}`);
        }
    }
    async fetchSeminovosHTML(url) {
        const headers = {
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,sm;q=0.6',
            'User-Agent': 'PostmanRuntime/7.34.0',
            'Host': 'seminovos.com.br'
        };
        try {
            const axiosInstance = this.createAxiosInstance();
            const response = await axiosInstance.get(url, { headers });
            return response.data;
        }
        catch (error) {
            throw new Error(`Error fetching HTML: ${error}`);
        }
    }
    filterElementsJson(html) {
        const $ = cheerio_1.default.load(html);
        const elements = [];
        $('script[type="application/ld+json"]').each((index, element) => {
            const scriptContent = $(element).html();
            if (scriptContent) {
                elements.push(scriptContent);
            }
        });
        return elements;
    }
    filterElementsJsonOlx(html) {
        const $ = cheerio_1.default.load(html);
        const elements = [];
        const nextDataScript = $('script#__NEXT_DATA__[type="application/json"]');
        if (nextDataScript.length > 0) {
            const scriptContent = nextDataScript.html();
            try {
                const jsonData = JSON.parse(scriptContent || '');
                elements.push(jsonData);
            }
            catch (error) {
                console.error(`Error parsing JSON: ${error}`);
            }
        }
        return elements;
    }
    formatCurrencyBRL(price) {
        const formatter = new intl_1.default.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });
        return formatter.format(price);
    }
    transformLink(link) {
        if (!link) {
            throw new Error("The provided link is null or undefined.");
        }
        const regex1 = /https:\/\/carros\.seminovosbh\.com\.br\/(\w+)\/(\w+)\/(\d+)\/(\d+)\/(\w+)/;
        const regex2 = /https:\/\/carros\.seminovosbh\.com\.br\/(\w+)-(\w+)-(\d+)-(\d+)-(\d+)-(\w+)\.jpeg/;
        const match1 = link.match(regex1);
        const match2 = link.match(regex2);
        if (match1) {
            return `https://seminovos.com.br/${match1[1]}-${match1[2]}-${match1[3]}-${match1[4]}--${match1[5]}`;
        }
        else if (match2) {
            return `https://seminovos.com.br/${match2[1]}-${match2[2]}-${match2[3]}-${match2[4]}--${match2[5]}`;
        }
        else {
            throw new Error("The provided link does not correspond to any expected format.");
        }
    }
    async getOlxProducts() {
        try {
            const html = await this.fetchHTML(OLX_URL);
            const links = this.filterElementsJsonOlx(html);
            const linksData = links[0];
            const products = linksData.props?.pageProps?.ads || [];
            const combinedData = products.map((product, index) => {
                return {
                    title: product.title,
                    price: product.price,
                    locationAndDate: {
                        location: product.location,
                        date: product.date
                    },
                    link: product.url
                };
            });
            this.productList.push(...combinedData);
            return this.productList;
        }
        catch (error) {
            console.error('Error getting OLX products:', error);
        }
    }
    async getSeminovosProducts() {
        try {
            for (let page = 1; page <= MAX_PAGES; page++) {
                const url = `${SEMINOVOS_BASE_URL}?page=${page}&ajax`;
                const html = await this.fetchSeminovosHTML(url);
                const productsList = this.filterElementsJson(html);
                const products = productsList.map(element => JSON.parse(element));
                const combinedData = products.map(product => ({
                    title: product.name,
                    price: this.formatCurrencyBRL(product.offers.price),
                    locationAndDate: "teste teste",
                    image: product.image,
                    link: this.transformLink(product.image)
                }));
                this.productList.push(...combinedData);
            }
            return this.productList;
        }
        catch (error) {
            console.error('Error getting Seminovos products:', error);
        }
    }
    async getProductListDetails() {
        try {
            const olxProducts = (await this.getOlxProducts()) || [];
            const seminovosProducts = (await this.getSeminovosProducts()) || [];
            const combinedProductList = [...olxProducts, ...seminovosProducts];
            const previousFileName = 'previousProductList.json';
            try {
                const previousData = fs_1.default.existsSync(previousFileName)
                    ? JSON.parse(fs_1.default.readFileSync(previousFileName, 'utf-8'))
                    : [];
                const differentItems = combinedProductList.filter((currentItem) => {
                    const found = previousData.find((previousItem) => {
                        return JSON.stringify(currentItem) === JSON.stringify(previousItem);
                    });
                    return !found;
                });
                fs_1.default.writeFileSync(previousFileName, JSON.stringify(combinedProductList, null, 2), 'utf-8');
                return differentItems;
            }
            catch (error) {
                console.error(`Error processing/writing JSON files: ${error}`);
                return [];
            }
        }
        catch (error) {
            console.error(`Error getting product details: ${error}`);
            return [];
        }
    }
    async execute() {
        try {
            const productListDetails = await this.getProductListDetails();
            const productList = new Set(productListDetails);
            const products = [...productList];
            products.forEach(item => {
                const message = `Title: ${item.title}\nPrice: ${item.price}\nLocation: ${item.locationAndDate.location}\nDate: ${item.locationAndDate.date}\nImage: ${item.image}\n\nLink: ${item.link}`;
                this.sendMessage(message);
            });
        }
        catch (error) {
            console.error(error);
        }
    }
}
const productScraper = new ProductScraper();
const app = (0, express_1.default)();
app.post('/scrape', async (req, res) => {
    await productScraper.execute();
    res.status(200).send('Scraping process initiated.');
});
exports.default = app;
