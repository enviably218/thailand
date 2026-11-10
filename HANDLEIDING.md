# Reisblog Thailand 2026: zo zet je hem online

Blog: https://enviably218.github.io/thailand/
Schrijven: https://enviably218.github.io/thailand/beheer.html

Het hele online zetten duurt ongeveer 15 minuten.

## 1. Repository aanmaken en uploaden

1. Maak op GitHub een nieuwe repository aan met de naam `thailand`. Kies **Public** en vink geen README aan. GitHub Pages is alleen gratis voor publieke repositories. Exacte locaties staan er versleuteld in.
2. Open een terminal in deze map (`thailand/`) en voer uit:

   ```bash
   git init -b main
   git add .
   git commit -m "Reisblog"
   git remote add origin https://github.com/enviably218/thailand.git
   git push -u origin main
   ```

   Gebruik je de `gh` CLI, dan kan het ook in één keer: `gh repo create thailand --public --source . --push`.

3. Zet `PRIVE-verblijven.json` **niet** in deze map. Het staat er bewust naast.

## 2. GitHub Pages aanzetten

1. Ga in de repository naar **Settings › Pages**.
2. Kies bij **Source** de optie **GitHub Actions**.
3. Ga naar het tabblad **Actions** en open "Site bouwen en publiceren".
4. Klik op **Run workflow**. De eerste push is waarschijnlijk mislukt omdat Pages toen nog uit stond; dat is normaal.
5. Na 1 à 2 minuten staat de blog online.

## 3. Sleutel maken om te kunnen posten

1. Ga naar GitHub **Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token**.
2. Stel de sleutel zo in:
   - **Expiration:** bijvoorbeeld 31 december 2026.
   - **Repository access:** *Only select repositories* › `thailand`.
   - **Permissions › Repository permissions › Contents:** *Read and write*.
3. Kopieer de sleutel (`github_pat_…`). Je gebruikt hem op je laptop en je telefoon.

Raak je je telefoon kwijt? Trek de sleutel dan in op GitHub. Dan kan niemand meer posten.

## 4. Eerste keer inloggen (laptop)

1. Open de beheerpagina (`…/beheer.html`) en plak je sleutel.
2. **Stel het wachtwoord in** voor exacte locaties. Gebruik een zin van een paar losse woorden, bijvoorbeeld `mango-tuktuk-regen-veertien`. Dit wachtwoord geef je aan familie en vrienden die je exacte locatie mogen zien.
3. Ga naar **Instellingen › Exacte locaties van verblijven** en kies `PRIVE-verblijven.json`.
4. Controleer de pins:
   - Ga naar **Tijdlijn**, klik bij elk verblijf op **Bewerken** en kijk of de paarse pin op je hotel staat.
   - Ik heb de adressen niet exact kunnen opzoeken. Kies "Klik op de kaart zet: Exacte locatie" en klik op de juiste plek. Het adres staat al ingevuld.
   - Klik op **Opslaan**.
5. Vul bij de vlucht **Chiang Mai → Phuket** het vluchtnummer en de roepnaam in zodra je die weet. Dat doe je onder Tijdlijn › Bewerken. Voorbeeld: Thai AirAsia FD 3xxx heeft roepnaam `AIQ3xxx`.

## 5. Telefoon

1. Open de beheerpagina, plak de sleutel en voer het wachtwoord in.
2. Zet de pagina op je beginscherm:
   - iPhone: Delen › Zet op beginscherm.
   - Android: menu › Toevoegen aan startscherm.
3. Maak een **testbericht** met "Gebruik mijn locatie" en een foto. Kijk of het na 1 à 2 minuten op de blog staat. Verwijder het daarna via **Berichten › Bewerken › Verwijderen**.

Zonder internet kun je toch posten. Het bericht komt dan in de wachtrij en wordt verstuurd zodra je weer verbinding hebt (open de pagina dan even).

## 6. Dagelijkse mail (Buttondown)

1. Maak een gratis account aan op https://buttondown.com.
2. Zoek in Buttondown de RSS-functie (RSS-to-email) en vul deze feed in: `https://enviably218.github.io/thailand/digest.xml`. Kies dat elk nieuw item als mail verstuurd wordt.
3. Vul op de beheerpagina onder **Instellingen** je Buttondown-gebruikersnaam in. Daarna verschijnt het aanmeldformulier op de blog.

De samenvatting van een dag sluit om 21:00 Nederlandse tijd. Buttondown verstuurt de mail kort nadat hij het nieuwe item ziet.

## Hoe het werkt

- **Locaties:** openbaar staat een cirkel van ongeveer 500 m op een vast raster, zodat je exacte plek niet het middelpunt is. Post je binnen 400 m van je verblijf, dan toont de blog alleen de wijk. De exacte coördinaten worden in je browser versleuteld (AES-256, sleutel afgeleid van het wachtwoord) voordat ze naar GitHub gaan.
- **Foto's** worden verkleind tot maximaal 1800 px en alle EXIF-gegevens, waaronder de GPS-positie, worden verwijderd.
- **Vluchten:**
  - Tijdens de vluchten zoekt GitHub Actions elke 5 minuten de positie op via adsb.lol en adsb.fi.
  - GitHub voert geplande taken soms met vertraging uit. Stukken boven zee kunnen ontbreken.
  - Wil je het beste resultaat? Download na de landing de tracklog bij FlightAware (knop *Google Earth*) en upload het KML-bestand onder **Vluchten**.
- **Na de reis** blijft de geplande taak elke 5 minuten kort draaien. Je kunt hem uitzetten onder Actions › "Site bouwen en publiceren" › ⋯ › Disable workflow.
- **Delen:** elk bericht heeft een WhatsApp-knop. De link (`/p/<id>.html`) toont in WhatsApp een voorbeeld met titel en foto, maar geen locatie.
