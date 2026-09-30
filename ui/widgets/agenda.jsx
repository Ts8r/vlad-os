import React, { useState, useEffect } from "react";
import { Fold, Gauge, BRIDGE, useHud } from "./_base.jsx";
import { AgendaSemaine } from "../agenda.jsx";

export const meta = {"id": "agenda", "titre": "Agenda", "icone": "◉", "categorie": "Quotidien", "description": "La semaine en bandeau interactif, clic = page Agenda.", "colonne": "left", "requiert": [], "perso": false};

export default function AgendaWidget() {
  const onOpen = useHud().ouvrirPage?.bind(null, "agenda");   // suivi réduit : bandeau semaine interactif → page Agenda
  return (
    <Fold id="agenda" title="Agenda">
      <AgendaSemaine onOpen={onOpen} />
    </Fold>
  );
}
