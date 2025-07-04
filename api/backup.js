const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const moment = require('moment');
const https = require('https');
const intl = require('intl');
const zlib = require('zlib');

moment.locale('pt-BR');

const TOKEN = 'x';
const ENDPOINT = 'x';

class ProductScraper {
    constructor() {
        this.productList = [];
        this.id = this.generateGUID();
        this.to = 'xx@telegram.gw.msging.net';
        this.type = 'text/plain';
        this.token = TOKEN;
        this.endpoint = ENDPOINT;
        this.execute();
    }

    generateGUID() {
        return uuidv4();
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
        } catch (error) {
            console.error('Erro na requisição:', error);
        }
    }

    createAxiosInstance() {
        return axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            })
        });
    }

    async fetchHTML(tipoImovel) {
        const baseURL = 'https://www.netimoveis.com/pesquisa';
        let params = {};
        if (tipoImovel && tipoImovel !== 'cobertura') {
            params = {
                tipo: 'apartamento',
                transacao: 'venda',
                localizacao: JSON.stringify([
                    {
                        urlPais: 'BR',
                        urlEstado: 'minas-gerais',
                        urlCidade: 'belo-horizonte',
                        urlRegiao: '',
                        urlBairro: '',
                        urlLogradouro: '',
                        idAgrupamento: '',
                        tipo: 'cidade',
                        idLocalizacao: 'BR-MG-belo-horizonte---'
                    }
                ]),
                pagina: 1,
                retornaPaginacao: true,
                outrasPags: true
            };
        }
        else {
            params = {
                tipo: 'cobertura',
                transacao: 'venda',
                localizacao: JSON.stringify([
                    {
                        urlPais: 'BR',
                        urlEstado: 'minas-gerais',
                        urlCidade: 'belo-horizonte',
                        urlRegiao: '',
                        urlBairro: '',
                        urlLogradouro: '',
                        idAgrupamento: '',
                        idLocalizacao: 'BR-MG-belo-horizonte---'
                    }
                ]),
                valorMaximo: 600000,
                vagas: 2,
                banhos: 2,
                quartos: 3,
                pagina: 1,
                valorMaximo: 600000,
                tipo: 'cobertura',
                pagina: 1,
                retornaPaginacao: true,
                outrasPags: true
            };
        }


        const headers = {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Encoding': 'br',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Referer': 'https://www.netimoveis.com/venda/minas-gerais/belo-horizonte/apartamento?tipo=apartamento&transacao=venda&localizacao=BR-MG-belo-horizonte---',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            'X-Requested-With': 'XMLHttpRequest'
        };

        try {
            const response = await axios.get(baseURL, {
                params,
                headers,
                responseType: 'arraybuffer'
            });

            // const decompressed = zlib.brotliDecompressSync(response.data);

            //  const jsonString = decompressed.toString('utf-8');

            const data = JSON.parse(response.data);

            return data;
        } catch (error) {
            console.error('Erro ao buscar dados:', error.message);
            throw error;
        }
    }

    formatCurrencyBRL(price) {
        const formatter = new intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });
        return formatter.format(price);
    };

    async getNetImoveisProducts(tipoImovel) {
        try {
            const responseData = await this.fetchHTML(tipoImovel);

            if (!responseData || !Array.isArray(responseData.lista)) {
                throw new Error('Lista de imóveis não encontrada ou inválida');
            }

            const products = responseData.lista.map((product) => {
                const dh = product.dataHoraUltimoAtualisacao?.objUltimoDH || {};
                let updatedPeriod = 'Atualizado recentemente';
                const parts = [];

                if (dh.years) parts.push(`${dh.years} ano${dh.years > 1 ? 's' : ''}`);
                if (dh.months) parts.push(`${dh.months} mês${dh.months > 1 ? 'es' : ''}`);
                if (dh.days) parts.push(`${dh.days} dia${dh.days > 1 ? 's' : ''}`);
                if (dh.hours) parts.push(`${dh.hours} hora${dh.hours > 1 ? 's' : ''}`);
                if (dh.min) parts.push(`${dh.min} minuto${dh.min > 1 ? 's' : ''}`);

                if (parts.length > 0) {
                    updatedPeriod = `Atualizado há ${parts.join(' e ')}`;
                }

                const updatedMinutesAgo =
                    (dh.years || 0) * 525600 +
                    (dh.months || 0) * 43200 +
                    (dh.days || 0) * 1440 +
                    (dh.hours || 0) * 60 +
                    (dh.min || 0);

                return {
                    title: `${product.tipoImovel1} no bairro ${product.nomeBairro}`,
                    price: this.formatCurrencyBRL(product.valorImovel),
                    locationAndDate: `${product.nomeBairro}, ${product.nomeCidade} - ${updatedPeriod}`,
                    image: product.nomeArquivoThumb,
                    link: `https://www.netimoveis.com/${product.urlDetalheImovel}`,
                    updatedPeriod,
                    updatedMinutesAgo
                };
            });

            // Ordena do mais recente para o mais antigo
            products.sort((a, b) => a.updatedMinutesAgo - b.updatedMinutesAgo);

            this.productList.push(...products);

            return this.productList;
        } catch (error) {
            console.error('Erro ao obter imóveis da Netimoveis:', error.message);
        }
    }


    async execute() {
        try {
            const productListDetails = await this.getNetImoveisProducts("cobertura");
            const productList = new Set(productListDetails);
            let products = [...productList];
       
            //  Filtra somente os imóveis atualizados nas últimas 24 horas (1440 minutos)

            products = products.filter(p => p.updatedMinutesAgo <= 1440);
                      
            products.forEach(item => {
                const message = `🏠 <b>${item.title}</b>\n` +
                    `💰 Preço: ${item.price}\n` +
                    `📍 Localização e data: ${item.locationAndDate}\n` +
                    `🖼️ Imagem: ${item.image}\n` +
                    `🔗 Link: ${item.link}`;


              //  this.sendMessage(message);
                console.log(message);
            });


        } catch (error) {
            console.error(error);
        }
    }
}

const productScraper = new ProductScraper();