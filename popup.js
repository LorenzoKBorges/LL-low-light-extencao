// Popup de apoio/debug — mostra, domínio por domínio, o status do
// horário ativo agora (o mesmo cálculo que o background.js faz de
// verdade), e tem um botão pra fazer a primeira autorização do Google.

const DIAS_JS_PARA_ENUM = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function obterSlotDoMomento(grade) {
    if (!grade || grade.length === 0) return null;

    const agora = new Date();
    const diaSemana = DIAS_JS_PARA_ENUM[agora.getDay()];
    const horaAtual = agora.toTimeString().slice(0, 8);

    return grade.find((slot) =>
        slot.dia_semana === diaSemana &&
        slot.hora_inicio <= horaAtual &&
        slot.hora_fim > horaAtual
    ) || null;
}

function renderizarStatus(dados) {
    const el = document.getElementById('status');

    if (!dados || dados.gradeAtualizadaEm === undefined) {
        el.textContent = 'Ainda não sincronizou com o servidor.';
        return;
    }

    const slotAtivo = obterSlotDoMomento(dados.grade);
    const linhas = [];

    if (!slotAtivo) {
        linhas.push(`<div class="linha">Nenhuma aula ativa agora.</div>`);
    } else {
        const agora = new Date();
        linhas.push(`<div class="linha"><span class="rotulo">Turma:</span> ${dados.turma || '-'}</div>`);

        (slotAtivo.dominios_bloqueados || []).forEach((dominio) => {
            const pausadoAte = slotAtivo.pausas && slotAtivo.pausas[dominio];
            const pausado = pausadoAte && agora < new Date(pausadoAte);
            const status = pausado ? 'Liberado' : 'Bloqueado';
            linhas.push(`<div class="linha">${dominio}: <b>${status}</b></div>`);
        });
    }

    linhas.push(`<div class="linha"><span class="rotulo">Grade sincronizada:</span> ${new Date(dados.gradeAtualizadaEm).toLocaleTimeString('pt-BR')}</div>`);
    el.innerHTML = linhas.join('');
}

chrome.storage.local.get(['grade', 'turma', 'gradeAtualizadaEm'], renderizarStatus);

document.getElementById('conectar').addEventListener('click', () => {
    const botao = document.getElementById('conectar');
    botao.disabled = true;
    botao.textContent = 'Conectando...';

    chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError || !token) {
            document.getElementById('status').textContent =
                'Falha ao conectar: ' + (chrome.runtime.lastError?.message || 'token não retornado');
            botao.disabled = false;
            botao.textContent = 'Conectar com Google';
            return;
        }

        chrome.runtime.sendMessage({ tipo: 'VERIFICAR_AGORA' }, () => {
            chrome.storage.local.get(['grade', 'turma', 'gradeAtualizadaEm'], renderizarStatus);
            botao.textContent = 'Conectado ✓';
        });
    });
});
