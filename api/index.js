const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const https = require('https');
const zlib = require('zlib');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

moment.locale('pt-BR');

TELEGRAM_GW_TOKEN = "dGVzdGVhMjU6NjEyRFNXb1VPZjhvVjFxbUtjSlE="
TELEGRAM_GW_ENDPOINT = "https://guilherme-nery-c5a2b.http.msging.net/messages"
TELEGRAM_RECIPIENT = "332422729@telegram.gw.msging.net"


class ProductService {
    constructor() {
        this.token = TELEGRAM_GW_TOKEN;
        this.endpoint = TELEGRAM_GW_ENDPOINT;
        this.recipient = TELEGRAM_RECIPIENT;
    }

    // Função para formatar o preço
    _formatCurrencyBRL(price) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(price);
    }

    // Função para formatar a mensagem para o Telegram
    _formatTelegramMessage(item) {
        return `🏠 <b>${item.title}</b>\n` +
            `💰 Preço: ${item.price}\n` +
            `📍 ${item.locationAndDate}\n` +
            `🔗 Link: ${item.link}`;
    }


    async _fetchRawData(proxyUrl = null) { // Adicione proxyUrl como parâmetro
        const baseURL = 'https://www.netimoveis.com/pesquisa';

        const params = {
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

        const urlParams = new URLSearchParams(params);
        const fullURL = `${baseURL}?${urlParams.toString()}`;

        const headers = new Headers({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', // Exemplo de User-Agent
            'Accept': 'application/json, text/plain, */*', // Indica que aceita JSON, texto ou qualquer coisa
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7', // Preferência de idioma
            'Connection': 'keep-alive',
            'Referer': 'https://www.netimoveis.com/', // Onde a requisição "originou"
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'x-requested-with': 'XMLHttpRequest'
        });


        let agent;
        if (proxyUrl) {
            console.log(`Usando proxy: ${proxyUrl}`);
            agent = new HttpsProxyAgent(proxyUrl);
        } else {
            agent = new https.Agent({
                rejectUnauthorized: false
            });
        }

        try {
            const response = await fetch(fullURL, {
                method: 'GET',
                headers: headers,
                agent: agent
            });
            console.log(response)

            if (!response.ok) {
                throw new Error(`Erro HTTP! Status: ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();

            return data;
        } catch (error) {
            console.error('Erro ao buscar dados:', error.message);
            throw error;
        }
    }

    // Método principal que busca, processa e retorna os produtos
    async getLatestProducts(minutesThreshold = 1440, proxyUrl = null) { // Adicione proxyUrl
        const responseData = await this._fetchRawData(proxyUrl); // Passe o proxyUrl

        if (!responseData || !Array.isArray(responseData.lista)) {
            throw new Error('A lista de imóveis não foi encontrada na resposta da API.');
        }

        const products = responseData.lista.map((product) => {
            const dh = product.dataHoraUltimoAtualisacao?.objUltimoDH || {};
            const parts = [];
            if (dh.years) parts.push(`${dh.years} ano(s)`);
            if (dh.months) parts.push(`${dh.months} mes(es)`);
            if (dh.days) parts.push(`${dh.days} dia(s)`);
            if (dh.hours) parts.push(`${dh.hours} hora(s)`);
            if (dh.min) parts.push(`${dh.min} minuto(s)`);

            const updatedPeriod = parts.length > 0 ? `Atualizado há ${parts.join(' e ')}` : 'Atualizado recentemente';

            const updatedMinutesAgo = (dh.years || 0) * 525600 + (dh.months || 0) * 43200 +
                (dh.days || 0) * 1440 + (dh.hours || 0) * 60 + (dh.min || 0);

            return {
                id: product.codigoImovel,
                title: `${product.tipoImovel1} no bairro ${product.nomeBairro}`,
                price: this._formatCurrencyBRL(product.valorImovel),
                locationAndDate: `${product.nomeBairro}, ${product.nomeCidade} - ${updatedPeriod}`,
                image: product.nomeArquivoThumb,
                link: `https://www.netimoveis.com/${product.urlDetalheImovel}`,
                updatedMinutesAgo
            };
        });

        // Filtra somente os imóveis atualizados nas últimas 24 horas (ou o threshold definido)
        return products
            .filter(p => p.updatedMinutesAgo <= minutesThreshold)
            .sort((a, b) => a.updatedMinutesAgo - b.updatedMinutesAgo);
    }

    // Envia uma única mensagem
    async sendMessage(content) {
        const data = {
            id: uuidv4(),
            to: this.recipient,
            type: 'text/plain',
            content: content,
        };
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${this.token}`,
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        };

        try {
            console.log('Enviando mensagem para o Telegram Gateway:', this.endpoint);
            await axios.post(this.endpoint, data, config);
            console.log('Mensagem de notificação enviada com sucesso.');
        } catch (error) {
            console.error('Erro ao enviar mensagem para o Telegram Gateway:', error.response?.data || error.message);
        }
    }

    // Envia notificações para uma lista de produtos
    async sendNotificationsForProducts(products) {
        const notificationPromises = products.map(product => {
            const message = this._formatTelegramMessage(product);
            return this.sendMessage(message);
        });

        await Promise.all(notificationPromises);
        console.log(`Total de ${products.length} notificações enviadas.`);
    }
}

// --- Configuração da API Express ---
const app = express();
const PORT = process.env.PORT || 3000;
const productService = new ProductService();
const timeToSearch = 60;

app.get('/api/get-updates', async (req, res) => {
    console.log("Recebida requisição em /api/get-updates");

    // Obtém o proxy da query parameter
    const proxy = req.query.proxy;
    if (proxy) {
        console.log(`Proxy recebido na requisição: ${proxy}`);
    }

    try {
        // 1. Busca os produtos mais recentes, passando o proxy se ele existir
        const recentProducts = await productService.getLatestProducts(timeToSearch, proxy);

        // 2. Envia as notificações em segundo plano (não precisa esperar a conclusão para responder à API)
        if (recentProducts.length > 0) {
            productService.sendNotificationsForProducts(recentProducts);
        }

        // 3. Responde à requisição com o JSON dos produtos encontrados
        res.status(200).json({
            message: `Encontrados ${recentProducts.length} imóveis atualizados nas últimas 24 horas.`,
            count: recentProducts.length,
            updatedAt: new Date().toISOString(),
            data: recentProducts
        });

    } catch (error) {
        console.error("Erro no endpoint /api/get-updates:", error);
        res.status(500).json({
            error: "Ocorreu um erro interno ao processar sua solicitação.",
            details: error.message
        });
    }
});

// Endpoint raiz para verificar se a API está no ar
app.get('/api', (req, res) => {
    res.send('API de monitoramento de imóveis está no ar! Use o endpoint /api/get-updates');
});

// Exporta o app para a Vercel
module.exports = app;

// Se não estiver na Vercel, inicia o servidor local
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Servidor rodando localmente em http://localhost:${PORT}`);
    });
}