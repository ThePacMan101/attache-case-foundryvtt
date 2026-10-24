# Como publicar o Attaché Case

Este guia coloca o módulo no GitHub para que qualquer pessoa instale no Foundry colando um link
(a "URL do manifesto"). Você faz os passos 1 a 6 **uma vez só**. Depois, lançar uma versão nova é
só o passo 7.

**O caminho todo:**

1. Criar a conta e o repositório no GitHub.
2. Criar uma senha especial (token) para enviar o código.
3. Enviar o código.
4. Criar o release `v1.0.0` (o GitHub monta o módulo sozinho).
5. Conferir se deu certo.
6. Instalar no seu Foundry e compartilhar o link.
7. Versões futuras.

> **Situação atual:** os passos 1 a 3 **já foram feitos**. O repositório é
> <https://github.com/ThePacMan101/attache-case-foundryvtt> (enviado por SSH) e os links do projeto
> já apontam para ele. **Comece pelo passo 4.** Os passos 1 a 3 ficam aqui só como referência.

Os comandos são colados no terminal do WSL (Arch Linux), onde o projeto está.

---

## 1. Conta e repositório no GitHub

1. Crie uma conta em <https://github.com/signup> (se ainda não tiver).
2. No canto superior direito, clique em **+** → **New repository**.
3. Preencha:
   - **Repository name:** `attache-case`
   - Marque **Public** (o Foundry precisa conseguir baixar os arquivos).
   - **Não** marque "Add a README", nem ".gitignore", nem "license". O projeto já tem tudo isso.
4. Clique em **Create repository**.

---

## 2. Token para enviar o código

O GitHub não aceita a sua senha no terminal. Ele pede um **token** (uma senha especial):

1. Clique na sua foto (canto superior direito) → **Settings**.
2. No fim do menu da esquerda: **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
3. **Token name:** `push attache-case`. **Expiration:** 90 dias (ou o que preferir).
4. **Repository access:** **Only select repositories** → escolha `attache-case`.
5. Em **Permissions** → **Repository permissions**, mude:
   - **Contents:** **Read and write**
   - **Workflows:** **Read and write** (sem isto o GitHub recusa a pasta `.github/workflows`)
6. Clique em **Generate token** e **copie** o token (começa com `github_pat_`). Guarde num lugar
   seguro: ele não aparece de novo.

---

## 3. Enviar o código

Cole no terminal **um bloco de cada vez**.

**3.1 Entrar na pasta e dizer qual é o seu usuário:**

```bash
cd /root/projects/foundryvtt/better-inventory
USUARIO=SEU_USUARIO
```

**3.2 Conferir o histórico.** O projeto já deve ter um commit inicial. Este comando mostra a lista
(aperte `q` para sair, se precisar):

```bash
git log --oneline
```

**3.3 Conferir seu nome e e-mail nos commits.** Os dois comandos abaixo devem mostrar o seu nome e um
e-mail:

```bash
git config user.name
git config user.email
```

Se algum vier vazio, defina (o GitHub mostra um e-mail "noreply" em **Settings → Emails**, se você
não quiser expor o seu):

```bash
git config --global user.name "Lucas Pimentel"
git config --global user.email "SEU_EMAIL_AQUI"
```

**3.4 Colocar o seu usuário nos links.** Os arquivos têm o marcador `OWNER` no lugar do usuário do
GitHub. Este comando troca pelo seu:

```bash
sed -i "s#github.com/OWNER/#github.com/$USUARIO/#g" module.json README.md CHANGELOG.md
```

**3.5 Conferir que os arquivos internos não vão subir.** A pasta `.llm/`, o `CLAUDE.md`, o
`AGENTS.md` e o `.env` ficam fora do GitHub de propósito: são as anotações dos agentes e os seus
dados de licença do Foundry. Este comando deve listar os quatro:

```bash
git check-ignore -v .llm CLAUDE.md AGENTS.md .env
```

**3.6 Gravar e enviar:**

```bash
git add -A
git commit -m "Set GitHub links"
git remote add origin "https://github.com/$USUARIO/attache-case.git"
git push -u origin main
```

Quando o terminal pedir **Username**, digite o seu usuário do GitHub. Quando pedir **Password**,
cole o **token** do passo 2 (não a senha da conta). Ao colar, nada aparece na tela; é normal, aperte
Enter.

> Opcional: para não precisar colar o token a cada envio, rode antes do `git push`
> `git config --global credential.helper store`. O token fica guardado num arquivo do seu computador
> (`~/.git-credentials`).

Abra `https://github.com/ThePacMan101/attache-case-foundryvtt` no navegador: os arquivos devem estar lá, com as
imagens do módulo no texto da página.

Na aba **Actions** do repositório aparece um item **CI** rodando (testes automáticos, uns 2 minutos).
Ele deve terminar com um ✓ verde.

---

## 4. Criar o release `v1.0.0`

1. Na página do repositório, na coluna da direita, clique em **Releases** →
   **Create a new release** (ou **Draft a new release**).
2. Clique em **Choose a tag**, digite `v1.0.0` e clique em **Create new tag: v1.0.0 on publish**.
   O formato tem que ser exatamente `v` + três números separados por ponto.
3. **Target:** `main`.
4. **Release title:** `v1.0.0`.
5. Na descrição, cole o trecho `## [1.0.0]` do arquivo `CHANGELOG.md` (ou clique em
   **Generate release notes**).
6. Deixe **Set as a pre-release** **desmarcado** e **Set as the latest release** **marcado**.
7. Clique em **Publish release**.

Pronto. O GitHub agora roda sozinho o processo **Release** (uns 2 minutos): testes → monta os
compêndios → cria `module.zip` e `module.json` → anexa os dois ao release.

---

## 5. Conferir se deu certo

1. Aba **Actions**: o item **Release** tem um ✓ verde.
   (Uma nota amarela dizendo `FOUNDRY_RELEASE_TOKEN is not set` é **normal**: é a parte opcional da
   lista oficial, veja o fim deste guia.)
2. Na página do release, em **Assets**, aparecem `module.json` e `module.zip`.
3. Abra este link no navegador. Ele deve mostrar um texto com
   `"version": "1.0.0"`:

   ```
   https://github.com/ThePacMan101/attache-case-foundryvtt/releases/latest/download/module.json
   ```

   **Esta é a URL do manifesto.** É ela que você vai usar e compartilhar.

**Se aparecer um X vermelho:** clique nele e depois no passo vermelho para ver o erro. Peça aos
agentes para corrigir. Depois:

1. Envie a correção:
   ```bash
   cd /root/projects/foundryvtt/better-inventory
   git add -A
   git commit -m "Fix release"
   git push
   ```
2. Apague o release com problema: abra o release → ícone de lixeira (**Delete**).
3. Apague a tag: abra `https://github.com/ThePacMan101/attache-case-foundryvtt/tags`, clique em `v1.0.0` →
   **Delete**.
4. Refaça o passo 4.

---

## 6. Instalar no Foundry e compartilhar

**No seu Foundry:**

1. Na tela inicial do Foundry (antes de entrar no mundo), abra a aba **Add-on Modules** (Módulos).
2. Clique em **Install Module** (**Instalar Módulo**).
3. No campo **Manifest URL** (**URL do Manifesto**), embaixo da janela, cole a URL do manifesto do
   passo 5.
4. Clique em **Install** (**Instalar**).
5. Entre num mundo de **Call of Cthulhu 7e** ou **Delta Green** → **Game Settings**
   (Configurações) → **Manage Modules** (Gerenciar Módulos) → marque **Attaché Case** → salve.
6. Para testar: abra a ficha de um personagem, clique no menu **⋮** no topo da ficha → **Attaché Case**
   (aparece como **Maleta** se o Foundry estiver em português). Ou aperte `I` com o seu personagem
   atribuído.

Se você já tiver uma pasta `attache-case` de testes em `Data/modules`, desinstale-a antes.

**Seus jogadores não instalam nada.** O módulo roda no servidor do Foundry: basta você ativá-lo no
mundo.

**Para outros mestres:** mande a URL do manifesto. Eles fazem os passos 1 a 5 acima no Foundry deles.
Você também pode mandar o link da página: `https://github.com/ThePacMan101/attache-case-foundryvtt` (o texto de
lá explica tudo em inglês).

---

## 7. Lançar uma versão nova no futuro

Você **não** muda o número da versão à mão em lugar nenhum. O número vem da tag do release.

1. Peça aos agentes as mudanças. Eles também atualizam o `CHANGELOG.md`.
2. Envie para o GitHub:
   ```bash
   cd /root/projects/foundryvtt/better-inventory
   git add -A
   git commit -m "Describe the change here"
   git push
   ```
3. Repita o passo 4 com uma tag nova:
   - correção pequena: `v1.0.1`;
   - novidade: `v1.1.0`;
   - mudança grande, que quebra algo: `v2.0.0`.

   Nunca reutilize uma tag que já existe.
4. Confira como no passo 5.

Quem instalou pela URL do manifesto recebe a atualização pelo próprio Foundry: aba **Add-on Modules**
→ **Update All** / **Check for Updates** (Atualizar).

---

## Problemas comuns

| O que aconteceu | O que fazer |
|---|---|
| `git push` recusado falando de `workflow` | O token não tem **Workflows: Read and write** (passo 2). Crie outro token. |
| `git push` pede senha e recusa | Cole o **token**, não a senha da conta. |
| `git remote add` diz que `origin` já existe | Rode `git remote set-url origin "https://github.com/$USUARIO/attache-case.git"` e depois o `git push`. |
| O link do `module.json` dá erro 404 | O release ainda está rodando, ficou como rascunho, ou falhou (veja a aba **Actions**). |
| Actions: "tag must look like v1.2.3" | A tag foi criada sem o `v` ou em outro formato. Apague o release e a tag (passo 5) e refaça. |
| O Foundry diz que o módulo não é compatível | O Foundry precisa ser a versão 14.359 ou mais nova. |
| O menu **Attaché Case** não aparece na ficha | Confira se o módulo está ativado no mundo e se o sistema é CoC7 ou Delta Green. |

---

## Lista oficial do Foundry (opcional, futuro)

Hoje o módulo é distribuído só pelo GitHub, como acima. Entrar na lista oficial de pacotes do
Foundry (a busca dentro do **Install Module**) **não é necessário**.

Se um dia quiser, saiba que a [Política de Conteúdo de IA](https://foundryvtt.com/article/ai-policy/)
da Foundry (revisada em 18/03/2026) vale para pacotes novos. Resumo honesto, sem aconselhamento
jurídico:

- **Textos da interface e descrições de itens** precisam ser escritos por uma pessoa. Aqui isso quer
  dizer reescrever, com as suas palavras, os textos de `lang/pt-BR.json` e dos containers prontos.
- **Tradução por IA** de um texto escrito por pessoa é permitida, se alguém fluente revisar.
- **A descrição do pacote** no site foundryvtt.com precisa ser escrita por você.
- **Código** feito com ajuda de IA é permitido, mas o autor precisa conseguir entender, explicar,
  modificar e manter todo o código. A Foundry pode pedir que você mostre isso.
- O envio é pelo formulário <https://foundryvtt.com/creators/submit/> (precisa de licença ativa; a
  revisão é manual e sem prazo informado).

O processo automático **já está pronto** para isso: depois de aprovado, copie o **Package Release
Token** da página do pacote na Foundry e salve no GitHub em **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**, com o nome `FOUNDRY_RELEASE_TOKEN`. A partir daí, cada release
também publica a versão na lista oficial. Sem esse segredo, essa parte é simplesmente pulada.

Sobre o nome e marcas: "Attaché Case" é um termo genérico (maleta). O módulo não usa arte, logos nem
textos da Capcom, da Chaosium ou da Arc Dream. Mantenha assim.

---

## Fontes (consultadas em 23/10/2026)

- Política de Conteúdo de IA da Foundry: <https://foundryvtt.com/article/ai-policy/>
- Envio de pacotes e FAQ: <https://foundryvtt.com/creators/submit/>, <https://foundryvtt.com/article/faq/>
- Package Release API (o token): <https://foundryvtt.com/article/package-release-api/>
- Instalar módulos por URL do manifesto: <https://foundryvtt.com/article/modules/>
- GitHub, releases: <https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository>
- GitHub, tokens: <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
