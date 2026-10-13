# Yggdrasil

En diagrameditor på svenska. Öppna `index.html` via en lokal webbserver, exempelvis XAMPP.

- Diagramtyper: flödesschema, algoritmflödesschema, organisationsschema, UML-klassdiagram, databasdiagram, mindmap (tankekarta), begreppskarta och tillståndsdiagram.
- Första starten och byte av diagramtyp ger ett tomt diagram. Klicka på Utforska ett exempel eller Visa ett exempel för att läsa in ett exempeldiagram. Ett tidigare diagram som sparats i webbläsaren återställs vid nästa besök.
- Dubbelklicka på en bubbla för att redigera text och nodtyp. Organisationsscheman har roll/ansvar, tankekartor och begreppskartor har anteckningar och tillstånd har åtgärder. Detaljerna visas i bubblan.
- Algoritmnoder visar hjälp för tilldelningar, villkor och input/print. Processrutornas editor har ett utfällbart bibliotek med räkneoperationer och matematiska funktioner. Klicka på ett exempel för att lägga till det i textfältet. Dubbelklicka på kopplingar för att ange text, Ja/Nej-gren eller övergångshändelse.
- Markera en bubbla för att ändra form, bakgrunds- och kantfärg, storlek, textstorlek, kanttjocklek och hörnradie i sidopanelen. Hörnradie gäller rundade rutor.
- Dra bubblor för att flytta. Koppla med verktyget Koppla eller Shift+klick. Delete tar bort markerat objekt.
- Kopplingar dras direkt när vägen är fri och runt andra objekt när det behövs. Dragningen försöker minska korsningar och uppdateras när objekten flyttas. Överlappande objekt kan fortfarande hindra en fri väg.
- Dokument sparas automatiskt i webbläsaren. JSON bevarar utseende och detaljer; Mermaid överför diagrammets struktur och huvudtext.
- Ny, Öppna och Spara finns samlade i sidhuvudet. Spara laddar ner en JSON-fil. Föreslagna filnamn har formatet `schematyp-MM-DD-HHMM`, exempelvis `algoritm-10-14-1430.json`, och använder lokal tid. Samma namngivning används för kod- och SQL-export.
- Endast algoritmflödesscheman har simulering och semantisk kontroll. Åtgärder i tillståndsdiagram är beskrivande text.

## Kodgenerering

Välj algoritmflödesschema eller UML-klassdiagram, välj Python eller JavaScript under fliken Exportera och klicka Generera. Koden kan markeras och kopieras eller laddas ner som `.py`/`.js`.

Algoritmer valideras före generering. Den genererade koden följer kopplingar, Ja/Nej-grenar och loopar via en tillståndsloop med maximalt 10 000 steg. Python körs med Python 3. JavaScript definierar `main(read, write)`; kör `main()` i webbläsaren eller skicka egna funktioner för in-/utmatning. Textspråket är samma som i simuleringen: tilldelningar, `input namn`, `print uttryck`, jämförelser och `&&`, `||`, `!`.

### Räkneoperationer och matematiska funktioner

Processrutor använder `namn = uttryck`. Separera flera tilldelningar med semikolon. Räkneoperationerna är `+`, `-`, `*`, `/` och `%` (rest vid division); parenteser styr beräkningsordningen. Använd punkt för decimaltal och ge variabler ett värde innan de används.

Bibliotekets särskilda avdelning Matematiska funktioner innehåller:

| Område | Funktioner |
| --- | --- |
| Tal och avrundning | `sqrt(x)`, `abs(x)`, `pow(x, y)`, `round(x)`, `floor(x)`, `ceil(x)`, `min(x, y)`, `max(x, y)` |
| Slumptal | `random()` ger ett decimaltal från 0 till under 1. |
| Trigonometri | `sin(x)`, `cos(x)`, `tan(x)`, `rad(grader)`, `deg(radianer)` |
| Logaritmer | `ln(x)` med basen e, `log10(x)` med basen 10, `exp(x)` för e upphöjt till x |

Funktionerna fungerar i simulatorn och vid export till Python och JavaScript. Trigonometriska funktioner använder radianer. Kvadratrot kräver ett icke-negativt tal och logaritmer kräver positiva tal. `round` avrundar halva steg uppåt, även för negativa tal. Slumpvärden genereras på nytt vid varje anrop.

```text
tarning = floor(random() * 6) + 1;
sinus = sin(rad(30));
logaritm = ln(8) / ln(2)
```

UML skapar klasskelett med attribut, metodsignaturer och enkelarv. Dubbelklicka på klasser för att ange attribut (exempel `name: str`) och metoder (exempel `greet(message: str): str`), en per rad. Använd kodnamn med A–Z, a–z, siffror och understreck. På kopplingen väljer du arv eller association; källklassen ärver målklassen. Associationer genereras som kommentarer. Metodernas innehåll implementeras i den exporterade koden. JSON bevarar klassdefinitionerna; Mermaid överför endast struktur och klassnamn.

UML-klasser och databastabeller visar namnet överst, innehållets namn eller signatur till vänster och typer till höger. UML har separata avdelningar för attribut och metoder med avdelande linjer.

Mindmap placerar ämnesgrenar runt huvudämnet med Auto-layout. När ett ämne är markerat kopplas ett nytt ämne automatiskt till det.

Bubblornas text använder `contrast-color(var(--bubble-background))`, där variabeln innehåller bubblans aktuella bakgrund (även under simulering). Äldre webbläsare får automatiskt svart eller vit text som reserv. Textfärgen väljs automatiskt och har därför ingen manuell färgkontroll.


## Databasdiagram och SQL-export

Välj Databasdiagram och dubbelklicka på en tabell för namn och kolumner, en per rad:

```text
id INTEGER PK
name VARCHAR(100) NOT NULL
email VARCHAR(255) UNIQUE
balance DECIMAL(10,2) NOT NULL DEFAULT 0
```

Typer: INTEGER, INT, BIGINT, SMALLINT, TEXT, REAL, FLOAT, DOUBLE, BOOLEAN, DATE, DATETIME, TIMESTAMP, BLOB, VARCHAR(n), CHAR(n), DECIMAL(p,s) och NUMERIC. Inställningar: PK (eller PRIMARY KEY), NOT NULL, UNIQUE och DEFAULT med tal, SQL-text inom enkla citattecken, NULL, TRUE, FALSE eller CURRENT_TIMESTAMP. Flera PK-kolumner ger en sammansatt primärnyckel. Automatisk ID-generering konfigureras inte av editorn.

Koppla den refererande tabellen till måltabellen. När kopplingen skapas öppnas editorn för val av källkolumn, målkolumn samt ON DELETE (RESTRICT, CASCADE, SET NULL eller NO ACTION). Dubbelklicka på relationen för att ändra valen senare. Flera relationer mellan samma tabeller och självreferenser stöds. Målkolumnen måste vara en ensam primärnyckel eller UNIQUE; kolumnernas datatyper måste matcha. SET NULL kräver en kolumn som tillåter NULL. Sammansatta främmande nycklar stöds inte.

Klicka Generera SQL och Ladda ner för en `.sql`-fil med CREATE TABLE, PRIMARY KEY, UNIQUE och FOREIGN KEY. SQL riktas mot SQLite. Aktivera `PRAGMA foreign_keys = ON` i SQLite-anslutningen innan schemat används. Exporten körs inte mot någon databas. JSON bevarar kolumner och relationer; Mermaid överför endast tabellnamn och kopplingar.


## Gränssnitt

Arbetsytan följer tre steg: välj diagramtyp, lägg till delar och redigera dem. Varje diagramtyp har en kort förklaring och ett exempel. Delarna i vänsterpanelen beskriver vad de används till.

Markera en del och välj Redigera, eller dubbelklicka direkt. Utseendet finns i fliken Redigera. Fliken Kontrollera ger vägledning och algoritmsimulering; Exportera samlar JSON, kod, SQL och Mermaid. Kopplingsverktyget visar vilken del du ska välja och visar en kopplingspekare även över objekten. Det avslutas efter en skapad koppling och behåller läget om försöket avvisas. Escape avbryter.

Zooma med +/− eller välj Visa hela. Ordna automatiskt placerar delarna och anpassar vyn. På små skärmar staplas panelerna. Tab navigerar mellan kontroller och diagramdelar; Enter eller mellanslag öppnar delens editor. När Koppla är aktivt väljer samma tangenter käll- och målobjekt. Verktygsflikarna stöder piltangenter.

## Tester

Kör från projektets rot. Matematiktestet kontrollerar även alla biblioteksexempel och export till JavaScript och Python:

```sh
node tests/connections.test.mjs
node tests/routing.test.mjs
node tests/math.test.mjs
```

Kodgenererings- och SQL-testerna importerar webbläsarmoduler som ES-moduler. Med Node.js 22 kan de köras så här:

```sh
node --experimental-default-type=module tests/codegen.test.mjs
node --experimental-default-type=module tests/sql.test.mjs
```

Matematik- och kodgenereringstesterna kräver Python 3. SQL-testet kräver Python 3 med SQLite. Kommandot `python` måste finnas i sökvägen.
