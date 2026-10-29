# Gallica PDF Downloader — Web 2.1, con ripresa del download

Applicazione web statica per GitHub e Render, con interfaccia blu. **Non richiede Python o un'estensione Chrome**. Le immagini vengono richieste da Gallica **direttamente dal browser**, non dal server Render. È necessario Chrome/Edge desktop aggiornato per la gestione delle cartelle sul disco.

## Come usare il programma

1. Incolla un collegamento Gallica e clicca «Scarica manifest JSON». Se non è disponibile il salvataggio automatico per CORS, clicca «Apri manifest in Gallica» e salvalo con Cmd+S o Ctrl+S.
2. Carica il JSON nella seconda sezione.
3. Facoltativamente clicca «Verifica prima immagine».
4. Premi «Scarica e genera PDF» e **scegli una cartella sul computer**, ad esempio `Documenti`. La web app creerà una sottocartella `Gallica_<identificativo>` in cui salverà i JPEG originali, un file `download-info.json` e infine il PDF unico `Gallica_<identificativo>_originale.pdf`.

## Se il download si interrompe, anche alla pagina 22

**Non cancellare la cartella creata**. Apri nuovamente la pagina, carica lo stesso manifest JSON e premi di nuovo «Scarica e genera PDF». **Seleziona la stessa cartella madre** usata prima (`Documenti`, nell'esempio). Il programma verifica le immagini già presenti, le riutilizza e scarica soltanto quelle mancanti. Alla fine crea **un unico PDF** contenente tutte le riproduzioni.

In caso di problemi di rete o CORS temporanei, il downloader esegue ulteriori tentativi con pause progressive. Non supera intenzionalmente cinque richieste di immagini al minuto: è previsto almeno un intervallo di 13 secondi fra richieste. Rispetta le risposte 429 e le eventuali istruzioni `Retry-After` del server. Un rifiuto esplicito 403 non viene ripetuto automaticamente. Dopo un riavvio del browser, la pausa del server può richiedere ulteriore attesa.

**Nota sui file:** per poter riprendere download molto lunghi, l'app conserva copie JPEG nella sottocartella. Una volta verificato il PDF finale, puoi eliminare manualmente i JPEG e `download-info.json` se non ti occorrono più; non eliminare il PDF.

## Pubblicazione su GitHub e Render

1. Estrai lo ZIP e carica nel repository GitHub il file `render.yaml`, `README.md`, `package.json` e l'intera cartella `site/` (comprendente `index.html`, `app.js`, `cache.js`, `engine.js`, `styles.css`). I file devono trovarsi nei rispettivi percorsi, non dentro una cartella aggiuntiva.
2. Se hai già pubblicato la versione web 2.0, **sostituisci i file della cartella `site` e conserva la configurazione Render già funzionante**. Se vuoi creare un nuovo servizio, scegli **New → Blueprint** e lascia `render.yaml` alla radice, oppure scegli un **Static Site** con Publish Directory `site`.
3. Una volta completato il deploy, aggiorna la pagina con un ricaricamento forzato per evitare file JavaScript in cache.

## Requisiti e limiti

- Chrome o Edge aggiornato su computer, con supporto `showDirectoryPicker` e accesso in scrittura alla cartella scelta.
- Risoluzione IIIF `full/full`, JPEG inseriti direttamente nel PDF senza ricompressione.
- Il programma **non supera blocchi permanenti CORS o 403** della BnF. Un errore `Failed to fetch` può derivare da rete, CORS, limiti temporanei o altro: non è identificabile con certezza dal solo messaggio del browser.
- La BnF pubblica limiti d'uso per immagini IIIF. Verifica le condizioni d'uso delle riproduzioni su Gallica.
- Il programma non è affiliato alla BnF e non può garantire la disponibilità delle immagini dal sito Gallica.

## Test

Con Node.js aggiornato: `npm test`. I test locali verificano il parser del manifest, il PDF e la ripresa con immagini già presenti in una cartella simulata. Non sostituiscono una prova reale di rete con Gallica.
