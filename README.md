# Gallica PDF Downloader — versione web (interfaccia blu)

Una web app da pubblicare su Render come **Static Site**. Gli utenti non devono installare Python o un'estensione. Due operazioni separate:

1. Incollare un normale link Gallica e premere **Scarica manifest JSON**.
2. Caricare il manifest sul sito, verificare la prima immagine e premere **Genera PDF originale**.

Le immagini vengono richieste a Gallica dal **browser**, NON dal server di Render. Il programma tenta di scaricarle con IIIF `full/full` e le inserisce in un unico PDF senza ricomprimere i JPEG. Un download alla volta, con almeno 13 secondi fra le richieste di immagini originali. Il PDF viene scritto progressivamente sul disco (Chrome o Edge su computer).

## Limite importante: CORS e 403

**Questa app non può garantire lo scaricamento da Gallica.** Se la BnF non consente a pagine web di altri domini di leggere le immagini tramite CORS, oppure restituisce HTTP 403, il browser non può recuperare i dati necessari a costruire il PDF. Aprire una fotografia in una nuova scheda non dimostra che il download via JavaScript sia consentito. Il pulsante **Verifica prima immagine** mostra subito se il metodo funziona.

Il salvataggio automatico del manifest richiede anch'esso CORS. Se fallisce, il programma offre il link **Apri manifest in Gallica**, da salvare manualmente con `Cmd+S` / `Ctrl+S` e caricare al punto 2. In assenza di CORS sulle immagini è necessario usare un'estensione Chrome con permessi per il dominio Gallica, oppure ottenere l'accesso API consentito dalla BnF. **Non basta cambiare hosting.**

## Pubblicazione su GitHub e Render (senza Terminale)

1. Estrai lo ZIP e apri il repository GitHub. Carica nella cartella principale: `render.yaml`, `README.md`, `package.json` e **la cartella `site/` con tutti i file al suo interno**. Non caricare soltanto lo ZIP.
2. Apri https://dashboard.render.com/ e premi **New → Blueprint**.
3. Seleziona il repository GitHub, ramo `main`; lascia `render.yaml` come Blueprint Path.
4. Conferma il deploy. Il Blueprint crea un **sito statico**; non serve configurare Python, `requirements.txt` o `gunicorn`.
5. Apri l'URL fornito da Render. Se il precedente servizio Gallica era un **Web Service Python**, il nuovo Static Site può richiedere la creazione di un servizio separato; non è una modifica in-place del vecchio Web Service.

Alternativa: **New → Static Site**, scegli il repository, Build Command `echo ready`, Publish Directory `site`.

## Compatibilità

Chrome/Edge desktop aggiornati per il salvataggio progressivo; URL Gallica con `ark:/12148/` e manifest IIIF Presentation v2/v3. Le immagini devono essere JPEG disponibili da `gallica.bnf.fr`. Non è un'applicazione ufficiale BnF. Rispetta le condizioni d'uso delle riproduzioni.

## Test locali

Se hai Node.js: `npm test` (testa estrazione del manifest e costruzione del PDF, senza contattare Gallica). Le limitazioni CORS vanno verificate nel browser pubblico.
