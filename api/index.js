const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const https = require('https');
const zlib = require('zlib');
require('dotenv').config();
const puppeteer = require('puppeteer');

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

    // Função para buscar os dados da Netimoveis
   async _fetchRawData() {
    const url = 'https://www.netimoveis.com/venda/minas-gerais/belo-horizonte/apartamento?tipo=apartamento&transacao=venda&localizacao=BR-MG-belo-horizonte---';

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

      // Aguarda o script do Nuxt carregar os dados (padrão em sites com Vue/Nuxt)
      const responseData = await page.evaluate(() => {
        return window.__NUXT__?.state?.[0] || null;
      });

      if (!responseData || !Array.isArray(responseData.lista)) {
        throw new Error('Não foi possível encontrar a lista de imóveis no estado da página.');
      }

      return responseData;
    } catch (err) {
      console.error('Erro ao buscar dados com Puppeteer:', err.message);
      throw err;
    } finally {
      await browser.close();
    }
  }


    // Método principal que busca, processa e retorna os produtos
    async getLatestProducts(minutesThreshold = 1440) { // 1440 minutos = 24 horas
        const responseData = await this._fetchRawData();

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
            type: 'text/plain', // Para usar o HTML do _formatTelegramMessage, o tipo deve ser 'application/vnd.lime.chatstate+json' ou similar dependendo da API
            content: content,
        };
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${this.token}`,
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Mantido do código original
        };

        try {
            console.log('Enviando mensagem para o Telegram Gateway:', this.endpoint);
            // Envia a mensagem para o endpoint do Telegram Gateway

            await axios.post(this.endpoint, data, config);
            console.log('Mensagem de notificação enviada com sucesso.');
        } catch (error) {
            console.error('Erro ao enviar mensagem para o Telegram Gateway:', error.response?.data || error.message);
        }
    }

    // Envia notificações para uma lista de produtos
    async sendNotificationsForProducts(products) {
        // Usamos Promise.all para enviar todas as mensagens em paralelo
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

    try {
        // 1. Busca os produtos mais recentes (últimas 24h)
        const recentProducts = await productService.getLatestProducts(timeToSearch);

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