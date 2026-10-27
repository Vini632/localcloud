# LocalCloud

Servidor pessoal de arquivos para usar entre computador e celular na mesma rede local.

> **Hospedagem:** este projeto precisa de Node.js e armazenamento persistente. GitHub Pages hospeda somente a interface estática e não executa uploads, pastas ou downloads do servidor. Para disponibilidade 24/7, use um VPS ou outro host com processo Node contínuo e disco persistente.

## Iniciar

```powershell
npm start
```

Abra no computador o endereço `http://localhost:4173`. No celular, conectado ao mesmo Wi-Fi, use o endereço de rede exibido no terminal, como `http://192.168.1.20:4173`.

Os arquivos ficam em `storage/` por padrão.

## Acessar de qualquer lugar

Este computador já está configurado com um Cloudflare Tunnel em:

```text
https://localcloud.worldforge.site
```

Para iniciar o servidor e o túnel juntos:

```powershell
npm run public
```

O usuário é `Nunes` e a senha fica no arquivo local `.localcloud-password`, que não deve ser compartilhado nem enviado para repositórios. O endereço público funciona enquanto este computador estiver ligado e o comando estiver em execução.

Para trocar a senha, edite `.localcloud-password`, salve somente a nova senha na primeira linha e reinicie `npm run public`.

## Proteger com senha

```powershell
$env:LOCALCLOUD_PASSWORD = "uma-senha-forte"
npm start
```

O navegador pedirá um usuário e uma senha. Use `Nunes` como usuário e a senha configurada.

## Configuração opcional

```powershell
$env:PORT = "8080"
$env:LOCALCLOUD_STORAGE = "D:\MeusArquivos"
$env:LOCALCLOUD_MAX_UPLOAD = "10737418240"
npm start
```

- `PORT`: porta do servidor (padrão: `4173`).
- `LOCALCLOUD_STORAGE`: pasta usada para armazenar arquivos.
- `LOCALCLOUD_MAX_UPLOAD`: limite por arquivo em bytes; `0` significa sem limite.

> O LocalCloud foi feito para uma rede local confiável. Não exponha a porta diretamente na internet.
