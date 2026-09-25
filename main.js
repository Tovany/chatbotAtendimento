const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
// const qrcode = require('qrcode-terminal');
const io = require('@pm2/io');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ==========================================
// ⚙️ CONFIGURAÇÃO DE INFRAESTRUTURA
// ==========================================
const ARQUIVO_JSON = './userStates.json';
const RESET_24H = 24 * 60 * 60 * 1000;
const NUMEROS_DONO = ['5591984308395@c.us', '559184308395@c.us']; 
let botAtivo = true; 

// Número de pareamento
const NUMERO_PAREAMENTO = '5591980103600';

// ==========================================
// 📊 MÉTRICAS PM2 (Acompanhamento em tempo real)
// ==========================================
const metricTotal = io.counter({ name: '01. Iniciaram Conversa' });
const metricSim = io.counter({ name: '02. Clicaram em SIM' });
const metricNao = io.counter({ name: '03. Clicaram em NÃO' });
const metricJaRev = io.counter({ name: '04. Já são Revendedores' });
const metricFinalizados = io.counter({ name: '05. Finalizaram o Fluxo ✅' });
const metricIntervencao = io.counter({ name: '06. Intervenção Humana 👤' });
const metricIgnorados = io.counter({ name: '07. Contatos Salvos 🚫' });

// ==========================================
// 🤖 INICIALIZAÇÃO DO CLIENT
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // executablePath: '/usr/bin/chromium-browser',
        headless: true,
        protocolTimeout: 60000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

const delay = ms => new Promise(res => setTimeout(res, ms));
const normalizarTexto = t => t ? t.toString().toLowerCase().trim() : '';

function log(tipo, msg) {
    console.log(`[${tipo}] ${new Date().toLocaleString()} → ${msg}`);
}

// ==========================================
// 💾 BANCO DE DADOS (JSON)
// ==========================================
let userStates = {};

try {
    if (fs.existsSync(ARQUIVO_JSON)) {
        userStates = JSON.parse(fs.readFileSync(ARQUIVO_JSON));
        log('INFO', 'Leads carregados do JSON');
    }
} catch (e) {
    log('ERRO', `Falha ao carregar JSON: ${e.message}`);
}

function salvarDados() {
    try {
        fs.writeFileSync(ARQUIVO_JSON, JSON.stringify(userStates, null, 2));
    } catch (e) {
        log('ERRO', `Falha ao salvar JSON: ${e.message}`);
    }
}

// ==========================================
// 📤 FUNÇÕES DE ENVIO
// ==========================================
async function enviarTexto(user, texto) {
    const state = userStates[user];
    if (!state || state.humano) return;

    try {
        state.ultimoEnvioBot = Date.now(); 
        await client.sendMessage(user, texto);
    } catch (e) {
        log('ERRO', `Falha envio texto ${user}: ${e.message}`);
    }
}

async function enviarMidia(user, fileName, options = {}) {
    const state = userStates[user];
    if (!state || state.humano) return;

    try {
        const caminho = path.join(__dirname, 'src', fileName);
        if (!fs.existsSync(caminho)) {
            log('ERRO', `Arquivo ausente: ${fileName}`);
            return;
        }

        state.ultimoEnvioBot = Date.now(); 
        const media = MessageMedia.fromFilePath(caminho);
        await client.sendMessage(user, media, options);
        await delay(2000);
    } catch (e) {
        log('ERRO', `Falha envio mídia ${fileName}: ${e.message}`);
    }
}

// ==========================================
// 🚀 FLUXO PRINCIPAL DE VENDAS
// ==========================================
async function iniciarFluxo(user, chat) {
    const state = userStates[user];
    if (!state || state.humano) return;

    try {
        log('INFO', `🚀 Fluxo de Vendas INICIADO: ${user}`);
        state.step = 'processando'; 
        salvarDados();

        await delay(6000);
        if (state.humano) return;

        if (chat) await chat.sendStateRecording();
        await delay(15000);
        await enviarMidia(user, 'apresentacao.mp3', { sendAudioAsVoice: true });

        await delay(9000);
        if (state.humano) return;

        if (chat) await chat.sendStateRecording();
        await delay(11000);
        await enviarMidia(user, 'descricao.mp3', { sendAudioAsVoice: true });

        await delay(12000);
        if (state.humano) return;

        await enviarMidia(user, 'imagem1.jpg', { caption: 'Confira nossos produtos.' });

        const imagens = ['imagem2.jpg','imagem3.jpg','imagem4.jpg','imagem5.jpg','imagem6.jpg'];
        for (let img of imagens) {
            if (state.humano) return;
            await delay(4000);
            await enviarMidia(user, img);
        }

        await delay(8000);
        if (state.humano) return;

        if (chat) await chat.sendStateTyping();
        await delay(5000);
        
        if (state.humano) return; 
        await enviarTexto(user, "*Dados necessários para análise*\n\n👉 CPF\n👉 Data de nascimento");

        state.concluido = true;
        state.step = 'finalizado'; 
        salvarDados();
        metricFinalizados.inc();
        log('INFO', `✅ Fluxo de Vendas CONCLUÍDO: ${user}`);

    } catch (err) {
        log('ERRO', `Falha de rede em fluxo ${user}: ${err.message}`);
        state.step = 'menu'; 
        salvarDados();
    }
}

// ==========================================
// 🛡️ EVENTOS DE AUTO-RECUPERAÇÃO
// ==========================================
client.on('qr', async (qr) => {
    // qrcode.generate(qr, { small: true });
    try {
        log('INFO', `⏳ Solicitando Código de Pareamento para o número ${NUMERO_PAREAMENTO}...`);
        
        // Pede o código de 8 dígitos para a Meta
        const pairingCode = await client.requestPairingCode(NUMERO_PAREAMENTO);
        
        console.log('\n========================================');
        console.log(`🔑 CÓDIGO DE PAREAMENTO: ${pairingCode}`);
        console.log('========================================\n');
        log('INFO', 'Digite o código acima na notificação do seu WhatsApp no celular.');
        
    } catch (err) {
        log('ERRO', `Falha ao gerar código de pareamento: ${err.message}`);
    }
});

client.on('ready', () => {
    log('INFO', '✅ Bot Online e operacional.');
});

client.on('disconnected', async (reason) => {
    log('ERRO', `❌ Queda de conexão: ${reason}`);
    try {
        await client.destroy(); 
    } catch (e) {} finally {
        process.exit(1); 
    }
});

client.on('auth_failure', async (msg) => {
    log('ERRO', `🔐 Autenticação revogada: ${msg}`);
    process.exit(1);
});

// ==========================================
// 👑 MODO SHADOW ADMIN & DETECTOR DE INTERVENÇÃO
// ==========================================
client.on('message_create', async (msg) => {
    
    if (['revoked', 'protocol', 'e2e_notification', 'call_log', 'system', 'ciphertext'].includes(msg.type)) return;

    // 1. COMANDOS ROOT (Dono controlando o bot pelo celular)
    if (msg.body && typeof msg.body === 'string' && msg.body.startsWith('!')) {
        const remetentePuro = msg.from.replace(/\D/g, ''); 
        const isDono = NUMEROS_DONO.includes(msg.from) || remetentePuro === '112128828678369' || msg.fromMe;

        if (isDono) {
            try {
                const args = msg.body.trim().split(' ');
                const comando = args[0].toLowerCase();
                const chatDestino = msg.fromMe ? msg.to : msg.from;

                if (comando === '!reset') {
                    if (args.length < 2) {
                        await client.sendMessage(chatDestino, '⚠️ Uso: !reset 55919XXXXXXX');
                        return;
                    }
                    let alvo = args[1].replace(/\D/g, '') + '@c.us';
                    if (userStates[alvo]) {
                        delete userStates[alvo];
                        salvarDados();
                        await client.sendMessage(chatDestino, `✅ Histórico de ${args[1]} apagado.`);
                    } else {
                        await client.sendMessage(chatDestino, `⚠️ Número não encontrado.`);
                    }
                    return;
                }

                if (comando === '!status') {
                    const ramTotal = (os.totalmem() / 1024 / 1024).toFixed(0);
                    const ramLivre = (os.freemem() / 1024 / 1024).toFixed(0);
                    const ramUsada = (ramTotal - ramLivre).toFixed(0);
                    const uptimeHoras = (process.uptime() / 3600).toFixed(1);
                    const relatorio = `*⚙️ MONITOR DA VPS*\n\n` +
                                      `💻 *RAM:* ${ramUsada}MB / ${ramTotal}MB\n` +
                                      `⏳ *Uptime:* ${uptimeHoras} horas\n` +
                                      `🔌 *Bot Ativo:* ${botAtivo ? 'Sim' : 'Não'}`;
                    await client.sendMessage(chatDestino, relatorio);
                    return; 
                }
            } catch (errAdmin) {
                log('ERRO', `Erro no comando admin: ${errAdmin.message}`);
            }
        }
    }

    // 2. DETECTOR DE INTERVENÇÃO HUMANA
    if (msg.fromMe) {
        if (msg.to === 'status@broadcast') return;
        
        // 🔥 ESCUDO ANTI-FANTASMA (Ignora pacotes de sincronização vazios)
        if (!msg.body && !msg.hasMedia && !['location', 'vcard', 'contacts_array'].includes(msg.type)) {
            return; 
        }

        let state = userStates[msg.to];

        // 🛡️ PROTEÇÃO CONTRA CORRIDA (Dá tempo do bot cadastrar o lead de anúncio)
        if (!state) {
            await delay(4000); 
            state = userStates[msg.to];

            if (!state) {
                // Se ainda não existe, o dono realmente iniciou uma conversa nova manualmente
                userStates[msg.to] = { step: 'humano', humano: true, concluido: true, ultimoEnvioBot: 0, lastInteraction: Date.now() };
                salvarDados(); 
                return;
            }
        }

        // ⏱️ FILTRO DE VELOCIDADE (Ignora a Saudação Automática do WhatsApp Business)
        const tempoResposta = Date.now() - state.lastInteraction;
        
        if (tempoResposta < 5000) {
            log('INFO', `Mensagem automática do celular ignorada no cliente ${msg.to}`);
            return; 
        }

        // Evita que o bot se auto-silencie com as próprias mensagens
        if (Date.now() - state.ultimoEnvioBot < 15000) {
            return; 
        }

        if (!state.humano) {
            state.humano = true; 
            salvarDados(); 
            metricIntervencao.inc();
            log('AVISO', `Intervenção humana detectada no cliente ${msg.to}. Bot silenciado.`);
        }
    }
});

// ==========================================
// 📥 RECEBIMENTO DE MENSAGENS (CORE)
// ==========================================
client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast') return; 
    if (!botAtivo) return;
    if (['revoked', 'protocol', 'e2e_notification', 'call_log', 'system', 'ciphertext'].includes(msg.type)) return; 
    if (msg.fromMe) return;

    // 🔥 ESCUDO ANTI-FANTASMA: Ignora mensagens vazias do sistema de anúncios
    if (!msg.body && !msg.hasMedia && !['location', 'vcard', 'contacts_array'].includes(msg.type)) {
        return; 
    }

    const user = msg.from;

    try {
        let chat = null;
        
        // 1. ISOLAMENTO DO CHAT
        // 🛑 TRAVA 0: BLOQUEIO ABSOLUTO DE GRUPOS
        // Verifica diretamente na string do ID se é um grupo (@g.us)
        if (msg.from.includes('@g.us')) {
            log('INFO', `Mensagem de grupo ignorada: ${msg.from}`);
            return; 
        }

        // 1. ISOLAMENTO DO CHAT (Apenas para pegar o chat para a função de Digitando...)
        try {
            chat = await msg.getChat();
        } catch (errChat) {
            // Ignora silenciosamente. O chat ficará null e o bot não vai simular "digitando", mas não vai crashar.
        }
        
        // 2. ISOLAMENTO DO CONTATO
        let isContatoSalvo = false;
        try {
            const contact = await msg.getContact();
            if (contact && typeof contact.isMyContact !== 'undefined') {
                isContatoSalvo = contact.isMyContact;
            }
        } catch (errContact) {
            // Se falhar, assume que não está salvo
        }
        
        // 🛑 TRAVA 1: Ignora contatos salvos
        if (isContatoSalvo) {
            if (!userStates[user]) {
                 metricIgnorados.inc();
                 userStates[user] = { step: 'ignorado', humano: true, concluido: true, ultimoEnvioBot: 0, lastInteraction: Date.now() };
                 salvarDados();
            }
            return; 
        }

        const resposta = normalizarTexto(msg.body);

        // 1️⃣ CADASTRO INICIAL (Novo Lead)
        if (!userStates[user]) {
            log('INFO', `✨ Novo lead detectado: ${user}`);
            
            userStates[user] = {
                step: 'boas_vindas_espera', 
                humano: false,
                concluido: false,
                ultimoEnvioBot: 0,
                lastInteraction: Date.now()
            };
            salvarDados();
            metricTotal.inc();

            await delay(2500); // Delay humano
            
            if(userStates[user].humano) return; 

            userStates[user].step = 'cidade';
            salvarDados();
            
            if (chat) await chat.sendStateTyping(); // Proteção aqui
            await delay(2000);

            await enviarTexto(user, "Olá, tudo bem? 😁\n\nMuito bom ter você aqui. Antes de continuarmos, qual é a sua cidade?");
            return;
        }

        const state = userStates[user];
        const tempoDesdeUltimaMsg = Date.now() - state.lastInteraction;

        // ♻️ MOTOR DE RESET 24H E ANTI-TRAVAMENTO
        if (tempoDesdeUltimaMsg > RESET_24H) {
            log('INFO', `♻️ Reset 24h acionado para: ${user}`);
            state.step = 'cidade';
            state.humano = false;
            state.concluido = false;
        } else if ((state.step === 'boas_vindas_espera' || state.step === 'menu_espera') && tempoDesdeUltimaMsg > 30000) {
            state.step = state.step === 'boas_vindas_espera' ? 'cidade' : 'menu';
            log('AVISO', `🔧 Destravamento automático acionado (Anti-Stuck): ${user}`);
        }

        state.lastInteraction = Date.now();
        salvarDados();

        // 🛑 TRAVAS DE CONCURRÊNCIA
        if (state.step === 'boas_vindas_espera' || state.step === 'menu_espera') return;
        if (state.humano || state.concluido || state.step === 'processando' || state.step === 'ignorado') return;

        // 2️⃣ RECEBE A CIDADE
        if (state.step === 'cidade') {
            state.cidade = msg.body;
            state.step = 'menu_espera'; 
            salvarDados();
            await delay(2000);
            
            if(state.humano) return;
            state.step = 'menu';
            salvarDados();

            if (chat) await chat.sendStateTyping(); // Proteção aqui
            await delay(2000);
            await enviarTexto(user,
`Ótimo😍! Você gostaria de saber mais sobre como ser revendedor(a) da romance?

1️⃣ - Sim
2️⃣ - Não
3️⃣ - Já sou revendedor(a)`
            );
            return;
        }

        // 3️⃣ RECEBE A OPÇÃO DO MENU
        if (state.step === 'menu') {
            if (['1','sim'].includes(resposta)) {
                metricSim.inc();
                await delay(2000);
                if (chat) await chat.sendStateTyping(); // Proteção aqui
                await delay(3000);

                await enviarTexto(user, "Perfeito 😍 só um momento que eu já irei lhe atender!");
                iniciarFluxo(user, chat);
            }
            else if (['2','nao','não'].includes(resposta)) {
                metricNao.inc();
                state.concluido = true;
                state.step = 'finalizado';
                salvarDados();
                await delay(3000);
                await enviarTexto(user, "Sem problemas 😊");
            }
            else if (['3','ja sou','já sou'].includes(resposta)) {
                metricJaRev.inc();
                metricIntervencao.inc();
                state.humano = true;
                state.step = 'finalizado';
                salvarDados();
                await enviarTexto(user, "Já já lhe respondo 😊");
            }
            return;
        }

    } catch (err) {
        log('ERRO', `Erro no loop principal: ${err.message}`);
    }
});

client.initialize();