
const exportFilteredToCSV = () => {
    if (filtered.length === 0) return;

    const data = filtered.map(p => ({
        Fecha: p.f,
        Consultor: p.a,
        Tipo: p.tType.toUpperCase(),
        Ruta: p.routeLabel,
        Establecimiento: p.e,
        Grupo: p.g || "",
        Kilometros: p.km,
        Confirmaciones: Array.isArray(bookingConfirmations[p.id]) ? bookingConfirmations[p.id].join(" | ") : (bookingConfirmations[p.id] || ""),
        Estado: finalizedIds.has(p.id) ? "GESTIONADO" : "PENDIENTE"
    }));

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Reporte_Logistica_${view}_${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
