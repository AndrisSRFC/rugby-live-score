# Rugby LIVE Score

Vienkārša web aplikācija regbija rezultāta rādīšanai ar vienu pastāvīgu publisko saiti.

## Kas ir iekšā
- Publiskā LIVE lapa: `/`
- Vadības panelis: `/admin.html`
- Rezultāta pogas: +1, +2, +3, +5, -1
- 40:00 taimeris ar Start/Stop
- 1./2. puslaiks
- Komandu nosaukumu maiņa
- Reāllaika atjaunināšana visiem skatītājiem ar Socket.IO
- Admin PIN

## Palaist datorā
1. Uzinstalē Node.js 18+
2. Atver termināli šajā mapē
3. `npm install`
4. `npm start`
5. Atver:
   - Publiski: http://localhost:3000/
   - Vadība: http://localhost:3000/admin.html

Noklusētais PIN: `1234`

## Pastāvīgs links internetā
Izvieto projektu uz Render, Railway, Fly.io vai cita Node.js hostinga.
Pēc izvietošanas galvenā adrese, piemēram:
`https://mans-regbijs.onrender.com/`
paliek nemainīga un vienmēr rāda aktuālo spēli.

Drošībai hostingā uzstādi vides mainīgo:
`ADMIN_PIN=izvelies-savu-pin`

## Piezīme
Šī pirmā versija glabā spēles stāvokli servera atmiņā. Ja hostings pārstartē serveri,
rezultāts atgriezīsies sākuma stāvoklī. Nākamajā versijā var pievienot datubāzi,
spēļu arhīvu, kluba logo, sponsorus un savu domēnu.
