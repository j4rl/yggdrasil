# Yggdrasil

En diagrameditor på svenska. Öppna `index.html` via en lokal webbserver, exempelvis XAMPP.

- Diagramtyper: flödesschema, algoritmflödesschema, organisationsschema, UML-klassdiagram, databasdiagram, mindmap (tankekarta), begreppskarta och tillståndsdiagram.
- Dubbelklicka på en bubbla för att redigera text och nodtyp. Organisationsscheman har roll/ansvar, tankekartor och begreppskartor har anteckningar och tillstånd har åtgärder. Detaljerna visas i bubblan.
- Algoritmnoder visar hjälp för tilldelningar, villkor och input/print. Dubbelklicka på kopplingar för att ange text, Ja/Nej-gren eller övergångshändelse.
- Markera en bubbla för att ändra form, bakgrunds- och kantfärg, storlek, textstorlek, kanttjocklek och hörnradie i sidopanelen. Hörnradie gäller rundade rutor.
- Dra bubblor för att flytta. Koppla med verktyget Koppla eller Shift+klick. Delete tar bort markerat objekt.
- Dokument sparas automatiskt i webbläsaren. JSON bevarar utseende och detaljer; Mermaid överför diagrammets struktur och huvudtext.
- Endast algoritmflödesscheman har simulering och semantisk kontroll. Åtgärder i tillståndsdiagram är beskrivande text.

## Kodgenerering

Välj algoritmflödesschema eller UML-klassdiagram, välj Python eller JavaScript under fliken Exportera och klicka Generera. Koden kan markeras och kopieras eller laddas ner som `.py`/`.js`.

Algoritmer valideras före generering. Den genererade koden följer kopplingar, Ja/Nej-grenar och loopar via en tillståndsloop med maximalt 10 000 steg. Python körs med Python 3. JavaScript definierar `main(read, write)`; kör `main()` i webbläsaren eller skicka egna funktioner för in-/utmatning. Textspråket är samma som i simuleringen: tilldelningar, `input namn`, `print uttryck`, jämförelser och `&&`, `||`, `!`.

UML skapar klasskelett med attribut, metodsignaturer och enkelarv. Dubbelklicka på klasser för att ange attribut (exempel `name: str`) och metoder (exempel `greet(message: str): str`), en per rad. Använd kodnamn med A–Z, a–z, siffror och understreck. På kopplingen väljer du arv eller association; källklassen ärver målklassen. Associationer genereras som kommentarer. Metodernas innehåll implementeras i den exporterade koden. JSON bevarar klassdefinitionerna; Mermaid överför endast struktur och klassnamn.

Mindmap placerar ämnesgrenar runt huvudämnet med Auto-layout. När ett ämne är markerat kopplas ett nytt ämne automatiskt till det.

Bubblornas text använder `contrast-color(var(--bubble-background))`, där variabeln innehåller bubblans aktuella bakgrund (även under simulering). Äldre webbläsare får automatiskt svart eller vit text som reserv. Textfärgen väljs automatiskt och har därför ingen manuell färgkontroll.

Verifiera kodgenereringen med `node tests/codegen.test.mjs` (kräver Node.js och Python 3).

## Databasdiagram och SQL-export

Välj Databasdiagram och dubbelklicka på en tabell för namn och kolumner, en per rad:

```text
id INTEGER PK
name VARCHAR(100) NOT NULL
email VARCHAR(255) UNIQUE
balance DECIMAL(10,2) NOT NULL DEFAULT 0
```

Typer: INTEGER, INT, BIGINT, SMALLINT, TEXT, REAL, FLOAT, DOUBLE, BOOLEAN, DATE, DATETIME, TIMESTAMP, BLOB, VARCHAR(n), CHAR(n), DECIMAL(p,s) och NUMERIC. Inställningar: PK (eller PRIMARY KEY), NOT NULL, UNIQUE och DEFAULT med tal, SQL-text inom enkla citattecken, NULL, TRUE, FALSE eller CURRENT_TIMESTAMP. Flera PK-kolumner ger en sammansatt primärnyckel. Automatisk ID-generering konfigureras inte av editorn.

Koppla den refererande tabellen till måltabellen. Dubbelklicka på relationen och välj källkolumn, målkolumn samt ON DELETE (RESTRICT, CASCADE, SET NULL eller NO ACTION). Flera relationer mellan samma tabeller och självreferenser stöds. Målkolumnen måste vara en ensam primärnyckel eller UNIQUE; kolumnernas datatyper måste matcha. SET NULL kräver en kolumn som tillåter NULL. Sammansatta främmande nycklar stöds inte.

Klicka Generera SQL och Ladda ner för en `.sql`-fil med CREATE TABLE, PRIMARY KEY, UNIQUE och FOREIGN KEY. SQL riktas mot SQLite. Aktivera `PRAGMA foreign_keys = ON` i SQLite-anslutningen innan schemat används. Exporten körs inte mot någon databas. JSON bevarar kolumner och relationer; Mermaid överför endast tabellnamn och kopplingar.

Verifiera SQL-export och referensintegritet med `node tests/sql.test.mjs` (kräver Node.js och Python 3 med SQLite).

## Gränssnitt

Arbetsytan följer tre steg: välj diagramtyp, lägg till delar och redigera dem. Varje diagramtyp har en kort förklaring och ett exempel. Delarna i vänsterpanelen beskriver vad de används till.

Markera en del och välj Redigera, eller dubbelklicka direkt. Utseendet finns i fliken Redigera. Fliken Kontrollera ger vägledning och algoritmsimulering; Exportera samlar JSON, kod, SQL och Mermaid. Menyn Mitt diagram öppnar sparade filer och skapar tomma diagram. Kopplingsverktyget visar vilken del du ska välja och avslutas efter kopplingen. Escape avbryter.

Zooma med +/− eller välj Visa hela. Ordna automatiskt placerar delarna och anpassar vyn. På små skärmar staplas panelerna. Tab navigerar mellan kontroller och diagramdelar; Enter öppnar delens editor. Verktygsflikarna stöder piltangenter.
