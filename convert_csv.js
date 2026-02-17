
import fs from 'fs';
import Papa from 'papaparse';

const csvPath = '/Users/juananmunoz/.gemini/antigravity/playground/primordial-juno/travel-planner/Listado_Hoteles_EMEA_2026 - Listado Clientes.csv';
const outputPath = '/Users/juananmunoz/.gemini/antigravity/playground/primordial-juno/travel-planner/src/clientData.json';

const fileContent = fs.readFileSync(csvPath, 'utf8');

Papa.parse(fileContent, {
    header: true,
    complete: (results) => {
        const cleanData = results.data.map(row => ({
            id: row['ID_ESTABLECIMIENTO'],
            name: row['Nombre del Establecimiento'],
            island: row['Isla'],
            municipality: row['Municipio'],
            region: row['Comunidad Autónoma']
        })).filter(item => item.name); // Filter empty lines

        fs.writeFileSync(outputPath, JSON.stringify(cleanData, null, 2));
        console.log(`Converted ${cleanData.length} records to ${outputPath}`);
    }
});
