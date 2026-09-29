// LL, Low Light — service worker da extensão
//
// Estratégia: em vez de perguntar "está bloqueado agora?" a cada
// navegação, a extensão baixa a GRADE INTEIRA da semana do aluno de
// tempos em tempos, e calcula sozinha, localmente (usando o relógio
// do próprio Chromebook), se existe bloqueio ativo. Isso garante que
// funciona corretamente mesmo se o Chromebook ficar sem internet por
// um tempo — inclusive de propósito.

const BACKEND_URL = 'https://ll-low-light.onrender.com';
const NOME_ALARME = 'll-low-light-sincronizar-grade';
const INTERVALO_MINUTOS = 2;

const DIAS_JS_PARA_ENUM = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

// -------- Sincronização periódica da grade --------

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(NOME_ALARME, { periodInMinutes: INTERVALO_MINUTOS });
    sincronizarGrade().finally(aplicarBloqueioEmTodasAsAbas);
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(NOME_ALARME, { periodInMinutes: INTERVALO_MINUTOS });
    sincronizarGrade().finally(aplicarBloqueioEmTodasAsAbas);
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === NOME_ALARME) {
        // sincroniza e, MESMO que a rede falhe, reavalia as abas já
        // abertas com o que já sabíamos — é isso que pega uma aba que
        // já estava aberta (ex: um vídeo tocando) quando o bloqueio
        // começou, já que ela nunca dispara um evento de navegação.
        sincronizarGrade().finally(aplicarBloqueioEmTodasAsAbas);
    }
});

function obterTokenGoogle(interactive = false) {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
            if (chrome.runtime.lastError || !token) {
                console.warn('LL Low Light: não foi possível obter o token do Google.', chrome.runtime.lastError);
                resolve(null);
            } else {
                resolve(token);
            }
        });
    });
}

async function sincronizarGrade() {
    const token = await obterTokenGoogle();

    // sem token agora, mas a grade da última sincronização continua
    // valendo — é ela que garante o funcionamento offline
    if (!token) return;

    try {
        const resposta = await fetch(`${BACKEND_URL}/api/extensao/minha-grade`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!resposta.ok) {
            console.warn('LL Low Light: backend recusou a consulta.', resposta.status);
            return;
        }

        const dados = await resposta.json();

        await chrome.storage.local.set({
            grade: dados.slots || [],
            turma: dados.turma || null,
            gradeAtualizadaEm: new Date().toISOString()
        });
    } catch (erro) {
        console.warn('LL Low Light: falha ao sincronizar a grade (offline?).', erro);
        // mantém a grade anterior — não apaga o que já sabíamos
    }
}

// -------- Cálculo local do bloqueio (funciona offline) --------

function obterSlotDoMomento(grade) {
    if (!grade || grade.length === 0) return null;

    const agora = new Date();
    const diaSemana = DIAS_JS_PARA_ENUM[agora.getDay()];
    const horaAtual = agora.toTimeString().slice(0, 8); // "HH:MM:SS"

    return grade.find((slot) =>
        slot.dia_semana === diaSemana &&
        slot.hora_inicio <= horaAtual &&
        slot.hora_fim > horaAtual
    ) || null;
}

// Verifica se a URL da aba bate com algum domínio bloqueado do slot
// atual, respeitando pausas individuais (um domínio pode estar
// pausado enquanto os outros da mesma aula continuam bloqueados).
function urlDeveSerBloqueada(slot, url) {
    if (!slot) return false;
    const agora = new Date();

    return (slot.dominios_bloqueados || []).some((dominio) => {
        if (!url.includes(dominio)) return false;

        const pausadoAte = slot.pausas && slot.pausas[dominio];
        const pausado = pausadoAte && agora < new Date(pausadoAte);
        return !pausado;
    });
}

// Varre TODAS as abas já abertas (não só navegações novas) e bloqueia
// qualquer uma que já devesse estar bloqueada agora. Sem isso, uma
// aba aberta ANTES do horário começar (ex: um vídeo já tocando)
// nunca seria reavaliada, porque `chrome.tabs.onUpdated` só dispara
// quando a URL muda — não quando o tempo passa.
async function aplicarBloqueioEmTodasAsAbas() {
    const cache = await chrome.storage.local.get(['grade']);
    const slotAtivo = obterSlotDoMomento(cache.grade);

    const abas = await chrome.tabs.query({});
    for (const aba of abas) {
        if (!aba.url) continue;
        if (aba.url.startsWith('chrome-extension://') || aba.url.startsWith('chrome://')) continue;

        if (urlDeveSerBloqueada(slotAtivo, aba.url)) {
            chrome.tabs.update(aba.id, { url: chrome.runtime.getURL('blocked.html') });
        }
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab.url) return;
    if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) return;

    chrome.storage.local.get(['grade'], (cache) => {
        const slotAtivo = obterSlotDoMomento(cache.grade);
        if (urlDeveSerBloqueada(slotAtivo, tab.url)) {
            chrome.tabs.update(tabId, { url: chrome.runtime.getURL('blocked.html') });
        }
    });
});

// Permite que o popup peça uma sincronização imediata (ex: logo após
// a primeira autorização interativa), sem esperar o próximo alarme.
chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
    if (mensagem?.tipo === 'VERIFICAR_AGORA') {
        sincronizarGrade().finally(aplicarBloqueioEmTodasAsAbas).then(() => sendResponse({ ok: true }));
        return true;
    }
});
