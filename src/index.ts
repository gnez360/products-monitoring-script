import { VercelRequest, VercelResponse } from '@vercel/node';
import express, { Request, Response } from 'express'
import axios from 'axios';
import cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import moment from 'moment';
import timezone from 'moment-timezone';
import https from 'https';
import intl from 'intl';
import { v4 as uuidv4 } from 'uuid';

moment.locale('pt-BR');

const OLX_URL = 'https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios/hyundai/i30/estado-mg/belo-horizonte-e-regiao?sf=1';
const SEMINOVOS_BASE_URL = 'https://seminovos.com.br/carro/hyundai/i30';
const MAX_PAGES = 5;

const TOKEN = 'dGVzdGVhMjU6NjEyRFNXb1VPZjhvVjFxbUtjSlE=';
const ENDPOINT = 'https://guilherme-nery-c5a2b.http.msging.net/messages';

interface ProductItem {
    title: string;
    price: string;
    locationAndDate: {
        location: string;
        date: number;
    };
    image: string;
    link: string;
}


class ProductScraper {
    private id: string;
    private productList: any[];
    private to: string;
    private type: string;
    private token: string;
    private endpoint: string;

    
    constructor() {
        this.productList = [];
        this.id = this.generateGUID();
        this.to = '332422729@telegram.gw.msging.net';
        this.type = 'text/plain';
        this.token = TOKEN;
        this.endpoint = ENDPOINT;

        this.execute();
        const localTime = timezone().tz('America/Sao_Paulo').format('YYYY-MM-DD HH:mm:ss');

        console.log(`[${localTime}] Executing the scraper...`);
    }

    private generateGUID(): string {
        return uuidv4();
    }

    private async sendMessage(content: string): Promise<void> {
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
        } catch (error) {
            console.error('Erro na requisição:', error);
        }
    }

    private createAxiosInstance(): any {
        return axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            })
        });
    }

    private async fetchHTML(url: string): Promise<any> {
        try {
            const axiosInstance = this.createAxiosInstance();
            const headers = {
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,sm;q=0.6',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Host': 'olx.com.br'
            };
            const response = await axiosInstance.get(url, { headers });
            return response.data;
        } catch (error) {
            throw new Error(`Error fetching HTML: ${error}`);
        }
    }

    private async fetchSeminovosHTML(url: string): Promise<any> {
        const headers = {
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,sm;q=0.6',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Host': 'seminovos.com.br'
        };

        try {
            const axiosInstance = this.createAxiosInstance();
            const response = await axiosInstance.get(url, { headers });
            return response.data;
        } catch (error) {
            throw new Error(`Error fetching HTML: ${error}`);
        }
    }

    private filterElementsJson(html: string): string[] {
        const $ = cheerio.load(html);
        const elements: string[] = [];

        $('script[type="application/ld+json"]').each((index, element) => {
            const scriptContent = $(element).html();
            if (scriptContent) {
                elements.push(scriptContent);
            }
        });

        return elements;
    }

    private filterElementsJsonOlx(html: string): object[] {
        const $ = cheerio.load(html);
        const elements: object[] = [];

        const nextDataScript = $('script#__NEXT_DATA__[type="application/json"]');

        if (nextDataScript.length > 0) {
            const scriptContent = nextDataScript.html();
            try {
                const jsonData = JSON.parse(scriptContent || '');
                elements.push(jsonData);
            } catch (error) {
                console.error(`Error parsing JSON: ${error}`);
            }
        }

        return elements;
    }

    private formatCurrencyBRL(price: number): string {
        const formatter = new intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });
        return formatter.format(price);
    }

    private transformLink(link: string | null): string {
        if (!link) {
            throw new Error("The provided link is null or undefined.");
        }

        const regex1 = /https:\/\/carros\.seminovosbh\.com\.br\/(\w+)\/(\w+)\/(\d+)\/(\d+)\/(\w+)/;
        const regex2 = /https:\/\/carros\.seminovosbh\.com\.br\/(\w+)-(\w+)-(\d+)-(\d+)-(\d+)-(\w+)\.jpeg/;

        const match1 = link.match(regex1);
        const match2 = link.match(regex2);

        if (match1) {
            return `https://seminovos.com.br/${match1[1]}-${match1[2]}-${match1[3]}-${match1[4]}--${match1[5]}`;
        } else if (match2) {
            return `https://seminovos.com.br/${match2[1]}-${match2[2]}-${match2[3]}-${match2[4]}--${match2[5]}`;
        } else {
            throw new Error("The provided link does not correspond to any expected format.");
        }
    }

    private async getOlxProducts(): Promise<any[] | undefined> {
        try {
            const html = await this.fetchHTML(OLX_URL);
            const links = this.filterElementsJsonOlx(html);
            const linksData: { props?: { pageProps?: { ads?: any[] } } } = links[0];
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
        } catch (error) {
            console.error('Error getting OLX products:', error);
        }
    }

    private async getSeminovosProducts(): Promise<any[] | undefined> {
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
        } catch (error) {
            console.error('Error getting Seminovos products:', error);
        }
    }
    
    private async getProductListDetails(): Promise<ProductItem[]> {
        try {
          const olxProducts = (await this.getOlxProducts()) || [];
          const seminovosProducts = (await this.getSeminovosProducts()) || [];
      
          const combinedProductList: ProductItem[] = [...olxProducts, ...seminovosProducts];
      
          const previousFileName = 'previousProductList.json';
      
          try {
        
            const tempPath = path.join('/tmp', previousFileName);
      
            const previousData: ProductItem[] = fs.existsSync(tempPath)
              ? JSON.parse(fs.readFileSync(tempPath, 'utf-8'))
              : [];
      
            const differentItems = combinedProductList.filter((currentItem) => {
              const found = previousData.find((previousItem) => {
                return JSON.stringify(currentItem) === JSON.stringify(previousItem);
              });
              return !found;
            });
      
          
            fs.writeFileSync(tempPath, JSON.stringify(combinedProductList, null, 2), 'utf-8');
      
            return differentItems;
          } catch (error) {
            console.error(`Error processing/writing JSON files: ${error}`);
            return [];
          }
        } catch (error) {
          console.error(`Error getting product details: ${error}`);
          return [];
        }
      }
    


    async execute(): Promise<void> {
        try {
            const productListDetails = await this.getProductListDetails();

            const productList = new Set(productListDetails);
            const products = [...productList];

            products.forEach(item => {
                const message = `Title: ${item.title}\nPrice: ${item.price}\nLocation: ${item.locationAndDate.location}\nDate: ${item.locationAndDate.date}\nImage: ${item.image}\n\nLink: ${item.link}`;
                this.sendMessage(message);
            });
        } catch (error) {
            console.error(error);
        }
    }
}



const productScraper = new ProductScraper();
const app = express();

const port = process.env.PORT || 8080

app.get('/', (_req: Request, res: Response) => {
  return res.send('Express Typescript on Vercel')
})

app.get('/ping', (_req: Request, res: Response) => {
  return res.send('pong 🏓')
})

app.listen(port, () => {
  return console.log(`Server is listening on ${port}`)
})

app.get('/scrape', async (req, res) => {
    await productScraper.execute();
    res.status(200).send('Scraping process initiated.');
});

export default app;
