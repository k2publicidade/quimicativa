"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type Stop = {
  orderId: number;
  sequence: number;
  customerName: string;
  address: string;
};

type Point = {
  stop: Stop | null;
  label: string;
  address: string;
  coordinates: [number, number];
};

type RouteGeometry = { type: "LineString"; coordinates: number[][] };

type Suggestion = {
  points: Point[];
  geometry: RouteGeometry;
  distanceKm: number;
  durationMinutes: number;
};

type RouteMapProps = {
  originAddress: string;
  stops: Stop[];
  canWrite: boolean;
  onApplySuggestion: (orderIds: number[], distanceKm: number) => Promise<void>;
};

const geocode = async (address: string, token: string): Promise<[number, number] | null> => {
  if (!address.trim()) return null;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${encodeURIComponent(token)}&country=br&language=pt&limit=1`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as { features?: { center?: [number, number] }[] };
    return data.features?.[0]?.center ?? null;
  } catch {
    return null;
  }
};

export default function RouteMap({ originAddress, stops, canWrite, onApplySuggestion }: RouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [applying, setApplying] = useState(false);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    if (!token || !stops.length || stops.every(stop => !stop.address)) {
      setState("unavailable");
      return;
    }

    let cancelled = false;
    setState("loading");
    setSuggestion(null);

    const locations = [
      ...(originAddress.trim() ? [{ stop: null, label: "Origem / depósito", address: originAddress }] : []),
      ...stops.map(stop => ({ stop, label: stop.customerName, address: stop.address })),
    ];

    Promise.all(locations.map(async location => {
      const coordinates = await geocode(location.address, token);
      return coordinates ? { ...location, coordinates } : null;
    })).then(async results => {
      const located = results.filter((point): point is Point => Boolean(point));
      if (cancelled) return;
      setPoints(located);

      const hasLocatedOrigin = !originAddress.trim() || located[0]?.stop === null;
      const locatedDeliveries = located.filter(point => point.stop !== null);
      if (!locatedDeliveries.length) {
        setState("error");
        return;
      }

      if (!hasLocatedOrigin || located.length < 2 || located.length > 12) {
        setState("ready");
        return;
      }

      try {
        const coordinates = located.map(point => point.coordinates.join(",")).join(";");
        const response = await fetch(`https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinates}?access_token=${encodeURIComponent(token)}&roundtrip=true&source=first&destination=first&geometries=geojson&overview=full`);
        if (!response.ok) throw new Error("optimization");
        const data = await response.json() as {
          waypoints?: { waypoint_index: number }[];
          trips?: { geometry: RouteGeometry; distance: number; duration: number }[];
        };
        const trip = data.trips?.[0];
        if (!trip || !data.waypoints?.length) throw new Error("optimization");
        const optimized = located
          .map((point, index) => ({ point, position: data.waypoints?.[index]?.waypoint_index ?? index }))
          .sort((a, b) => a.position - b.position)
          .map(item => item.point);
        if (!cancelled) {
          setSuggestion({
            points: optimized,
            geometry: trip.geometry,
            distanceKm: trip.distance / 1000,
            durationMinutes: trip.duration / 60,
          });
        }
      } catch {
        // Os pontos continuam disponíveis para conferência mesmo sem otimização.
      }
      if (!cancelled) setState("ready");
    });

    return () => { cancelled = true; };
  }, [originAddress, stops, token]);

  useEffect(() => {
    if (state !== "ready" || !container.current || !points.length || !token) return;
    const displayedPoints = suggestion?.points ?? points;
    mapboxgl.accessToken = token;
    map.current?.remove();
    const instance = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: displayedPoints[0].coordinates,
      zoom: 9,
    });
    map.current = instance;
    instance.addControl(new mapboxgl.NavigationControl(), "top-right");
    instance.on("load", () => {
      const bounds = new mapboxgl.LngLatBounds();
      displayedPoints.forEach((point, index) => {
        bounds.extend(point.coordinates);
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        const detail = document.createElement("div");
        const deliveryNumber = displayedPoints.slice(0, index + 1).filter(item => item.stop !== null).length;
        title.textContent = point.stop ? `${deliveryNumber}. ${point.label}` : point.label;
        detail.textContent = point.address;
        popup.appendChild(title);
        popup.appendChild(detail);
        new mapboxgl.Marker({ color: point.stop ? "#2876e5" : "#173f6b" })
          .setLngLat(point.coordinates)
          .setPopup(new mapboxgl.Popup().setDOMContent(popup))
          .addTo(instance);
      });
      if (displayedPoints.length > 1) instance.fitBounds(bounds, { padding: 55, maxZoom: 13 });
      instance.addSource("route-line", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: suggestion?.geometry ?? {
            type: "LineString",
            coordinates: displayedPoints.map(point => point.coordinates),
          },
        },
      });
      instance.addLayer({
        id: "route-line",
        type: "line",
        source: "route-line",
        paint: { "line-color": "#2876e5", "line-width": 4, "line-opacity": 0.8 },
      });
    });
    return () => {
      instance.remove();
      map.current = null;
    };
  }, [points, suggestion, state, token]);

  const apply = async () => {
    if (!suggestion) return;
    setApplying(true);
    try {
      await onApplySuggestion(
        suggestion.points.flatMap(point => point.stop ? [point.stop.orderId] : []),
        suggestion.distanceKm,
      );
    } finally {
      setApplying(false);
    }
  };

  if (state === "unavailable") {
    return <div className="map-fallback"><strong>Mapa interativo não configurado</strong><span>Defina NEXT_PUBLIC_MAPBOX_TOKEN para calcular a rota viária e visualizar os endereços.</span></div>;
  }
  if (state === "error") {
    return <div className="map-fallback"><strong>Não foi possível localizar os endereços</strong><span>Revise cidade, estado e CEP no cadastro dos clientes.</span></div>;
  }

  const deliveryCount = points.filter(point => point.stop !== null).length;
  const exceedsLimit = points.length > 12;
  const missingOrigin = Boolean(originAddress.trim()) && points[0]?.stop !== null;
  const statusText = state === "loading"
    ? "Localizando e calculando..."
    : suggestion
      ? `${suggestion.distanceKm.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km · ${Math.round(suggestion.durationMinutes)} min estimados · ida e volta ao depósito`
      : exceedsLimit
        ? `Otimização disponível para até ${originAddress.trim() ? 11 : 12} entregas por rota`
        : missingOrigin
          ? "Não foi possível localizar o ponto de partida"
          : `${deliveryCount} de ${stops.length} entrega(s) localizada(s)`;

  return <div className="route-map-wrap">
    <div className="route-map-toolbar">
      <span>{statusText}</span>
      {suggestion && canWrite && <button type="button" onClick={apply} disabled={applying}>{applying ? "Aplicando..." : "Aplicar melhor sequência"}</button>}
    </div>
    <div className="route-map" ref={container} aria-label="Mapa interativo da rota" />
  </div>;
}
