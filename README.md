# Yggdrasil

En diagrameditor på svenska. Öppna `index.html` via en lokal webbserver, exempelvis XAMPP.

- Diagramtyper: flödesschema, algoritmflödesschema, organisationsschema, UML-klassdiagram, mindmap (tankekarta), begreppskarta och tillståndsdiagram.
- Dubbelklicka på en bubbla för att redigera text och nodtyp. Organisationsscheman har roll/ansvar, tankekartor och begreppskartor har anteckningar och tillstånd har åtgärder. Detaljerna visas i bubblan.
- Algoritmnoder visar hjälp för tilldelningar, villkor och input/print. Dubbelklicka på kopplingar för att ange text, Ja/Nej-gren eller övergångshändelse.
- Markera en bubbla för att ändra form, bakgrunds- och kantfärg, storlek, textstorlek, kanttjocklek och hörnradie i sidopanelen. Hörnradie gäller rundade rutor.
- Dra bubblor för att flytta. Koppla med verktyget Koppla eller Shift+klick. Delete tar bort markerat objekt.
- Dokument sparas automatiskt i webbläsaren. JSON bevarar utseende och detaljer; Mermaid överför diagrammets struktur och huvudtext.
- Endast algoritmflödesscheman har simulering och semantisk kontroll. Åtgärder i tillståndsdiagram är beskrivande text.

## Kodgenerering

Välj algoritmflödesschema eller UML-klassdiagram, välj Python eller JavaScript i sidopanelen och klicka Generera. Koden kan markeras och kopieras eller laddas ner som `.py`/`.js`.

Algoritmer valideras före generering. Den genererade koden följer kopplingar, Ja/Nej-grenar och loopar via en tillståndsloop med maximalt 10 000 steg. Python körs med Python 3. JavaScript definierar `main(read, write)`; kör `main()` i webbläsaren eller skicka egna funktioner för in-/utmatning. Textspråket är samma som i simuleringen: tilldelningar, `input namn`, `print uttryck`, jämförelser och `&&`, `||`, `!`.

UML skapar klasskelett med attribut, metodsignaturer och enkelarv. Dubbelklicka på klasser för att ange attribut (exempel `name: str`) och metoder (exempel `greet(message: str): str`), en per rad. Använd kodnamn med A–Z, a–z, siffror och understreck. På kopplingen väljer du arv eller association; källklassen ärver målklassen. Associationer genereras som kommentarer. Metodernas innehåll implementeras i den exporterade koden. JSON bevarar klassdefinitionerna; Mermaid överför endast struktur och klassnamn.

Mindmap placerar ämnesgrenar runt huvudämnet med Auto-layout. När ett ämne är markerat kopplas ett nytt ämne automatiskt till det.

Bubblornas text använder `contrast-color(var(--bubble-background))`, där variabeln innehåller bubblans aktuella bakgrund (även under simulering). Äldre webbläsare får automatiskt svart eller vit text som reserv. Textfärgen väljs automatiskt och har därför ingen manuell färgkontroll.

Verifiera kodgenereringen med `node tests/codegen.test.mjs` (kräver Node.js och Python 3).
