import React, { useId } from 'react';
import virginiaMap from './virginia-map.json';
import './city-map.css';

// The outline and city markers use the same linear longitude/latitude projection.
// Latitude/longitude are geographic; the terrain illustrations are decorative.
const WIDTH = 1200;
const HEIGHT = 650;
const BOUNDS = { west: -84, east: -75, south: 36.3, north: 39.7 };
const PADDING = 64;
const project = (longitude, latitude) => [
  PADDING + ((longitude - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * (WIDTH - PADDING * 2),
  PADDING + ((BOUNDS.north - latitude) / (BOUNDS.north - BOUNDS.south)) * (HEIGHT - PADDING * 2),
];
const outline = virginiaMap.geometry.coordinates.map((ring) => ring.map(([longitude, latitude], index) => `${index ? 'L' : 'M'}${project(longitude, latitude).map((number) => number.toFixed(2)).join(' ')}`).join(' ') + 'Z').join(' ');
const labelPlacement = {
  Charlottesville: 'west', Leesburg: 'north-east', Alexandria: 'east',
  Richmond: 'south-east', Roanoke: 'south-west', Winchester: 'north-west',
};

function HouseSketch() {
  return <svg viewBox="0 0 72 62" aria-hidden="true"><path d="M10 26h51v31H10z" fill="#d2ad83" stroke="#796e50" strokeWidth="1.5" /><path d="m5 26 14-15h31l15 15z" fill="#7e8a6a" stroke="#596950" strokeWidth="1.5" /><path d="M17 32h9v10h-9zm29 0h9v10h-9z" fill="#ebd99e" stroke="#83784f" strokeWidth="1.5" /><path d="M32 38h9v19h-9z" fill="#768a74" stroke="#5d725e" strokeWidth="1.5" /><path d="M8 57h57M13 47h15m16 0h13" stroke="#a38660" strokeWidth="2" /><path d="M51 8h7v10h-7z" fill="#aa8063" stroke="#796e50" strokeWidth="1.5" /><path d="M5 56h9m-2-5v7m48-1h9m-5-7v9" stroke="#7d9567" strokeWidth="4" /></svg>;
}

export default function CityMap({ cities = [], selectedCityId, onSelectCity, onOpenProperty, loading = false, error = '', onRetry }) {
  const unique = useId().replace(/:/g, '');
  const stateClipId = `${unique}-va-clip`;
  const paperId = `${unique}-paper`;
  const selectedCity = cities.find((city) => city.id === selectedCityId) || cities[0];
  const markers = cities.filter((city) => Number.isFinite(Number(city.latitude)) && Number.isFinite(Number(city.longitude)));
  const message = typeof error === 'string' ? error : error?.message || '';

  return <section className="city-map" aria-labelledby="city-map-heading" aria-busy={loading}>
    <div className="city-map-sheet">
      <header className="city-map-heading"><p>DWELLO / A NEIGHBORHOOD ATLAS</p><h1 id="city-map-heading" tabIndex={-1}>Virginia</h1><span>Choose a city. Find a little place to call home.</span></header>
      <div className="city-map-viewport">
        <div className="city-map-canvas">
          <svg className="city-map-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
            <defs><clipPath id={stateClipId}><path d={outline} /></clipPath><pattern id={paperId} width="11" height="11" patternUnits="userSpaceOnUse"><path d="M1 2h1M7 8h1" stroke="#827c59" strokeWidth=".6" opacity=".2" /></pattern></defs>
            <rect width={WIDTH} height={HEIGHT} fill="#e9e1be" />
            <path d="M1021 0h179v650H998q-33-54 7-114t5-126q-12-59 24-110t-3-100q-32-45-10-95z" fill="#bad0c8" opacity=".65" />
            <g fill="none" stroke="#b6b39b" strokeWidth="1" opacity=".42"><path d="M0 151H1200M0 306H1200M0 460H1200" /><path d="M285 0V650M521 0V650M760 0V650M999 0V650" /></g>
            <path d={outline} transform="translate(4 5)" fill="#aaa986" opacity=".25" />
            <path d={outline} fill="#bdc69c" stroke="#778967" strokeWidth="2.3" strokeLinejoin="round" fillRule="evenodd" />
            <g clipPath={`url(#${stateClipId})`}>
              <path d="M170 539q141-38 260-80t212-172q44-51 124-127l33 26q-109 101-164 205-124 119-402 181z" fill="#a3b387" opacity=".7" />
              <path d="M213 536q183-60 286-137t193-143M272 550q183-58 275-151t146-155M438 510q133-82 207-194t118-122" fill="none" stroke="#91a27c" strokeWidth="2" opacity=".6" />
              <g fill="#9bad80" stroke="#819571" strokeWidth="1.4"><path d="m400 435 13-24 14 24-12-7zm45-31 16-28 17 28-17-10zm31 28 15-27 16 27-15-8zm51-79 15-26 17 26-17-8zm48-45 17-29 17 29-17-9zm45-60 14-25 16 25-16-8zm46-52 15-29 17 29-16-8z" /></g>
              <g fill="#839a71" opacity=".65"><path d="m307 493 6-12 6 12h-5v7h-2v-7zm22-10 6-12 6 12h-5v7h-2v-7zm33-13 7-14 7 14h-6v9h-2v-9zm193 19 6-12 6 12h-5v7h-2v-7zm27 4 8-15 8 15h-7v9h-2v-9zm58-64 7-14 7 14h-6v9h-2v-9zm151 44 7-14 7 14h-6v9h-2v-9zm21 9 6-12 6 12h-5v7h-2v-7zm-75-99 7-14 7 14h-6v9h-2v-9zm-57-54 7-14 7 14h-6v9h-2v-9z" /></g>
              <path d="M826 329q-40 19-5 38t31 33q36 4 51 41t64 21" fill="none" stroke="#90b5ad" strokeWidth="4" opacity=".8" />
              <path d="M967 282q-24 56-5 80t-17 83q-1 26 44 54" fill="none" stroke="#a2c0b7" strokeWidth="13" />
              <path d="M957 334q-17-3-45-27m38 75q-30-8-55-24m54 70-43-18" fill="none" stroke="#a2c0b7" strokeWidth="5" />
            </g>
            <text x="620" y="500" fill="#657c59" fontFamily="Georgia,serif" fontSize="30" letterSpacing="10" opacity=".72">VIRGINIA</text>
            <text x="480" y="345" fill="#73815e" fontFamily="Georgia,serif" fontSize="13" fontStyle="italic" transform="rotate(-43 480 345)">Blue Ridge Mountains</text>
            <text x="556" y="175" fill="#9a987c" fontFamily="Georgia,serif" fontSize="15" fontStyle="italic">West Virginia</text>
            <text x="839" y="76" fill="#9a987c" fontFamily="Georgia,serif" fontSize="15" fontStyle="italic">Maryland</text>
            <text x="574" y="597" fill="#9a987c" fontFamily="Georgia,serif" fontSize="15" fontStyle="italic">North Carolina</text>
            <text x="1090" y="405" fill="#739a94" fontFamily="Georgia,serif" fontSize="16" fontStyle="italic" transform="rotate(-80 1090 405)">Atlantic Ocean</text>
            <g transform="translate(1100 105)" fill="none" stroke="#85927a" strokeWidth="1.4"><path d="M0-30V30M-22 0h44" /><path d="m0-28-5 13 5-3 5 3z" fill="#819074" /><circle r="15" /><text x="0" y="-39" stroke="none" fill="#60725b" textAnchor="middle" fontFamily="Georgia,serif" fontSize="15">N</text></g>
            <rect width={WIDTH} height={HEIGHT} fill={`url(#${paperId})`} pointerEvents="none" />
            <path d="M25 24H1175V626H25z" fill="none" stroke="#aaa68b" strokeWidth="1" strokeDasharray="2 5" opacity=".7" />
          </svg>
          <div className="city-map-markers" aria-label="Virginia cities">{markers.map((city) => {
            const [x, y] = project(Number(city.longitude), Number(city.latitude));
            const isSelected = city.id === selectedCity?.id;
            return <button key={city.id} id={`city-marker-${city.id}`} className={`city-map-marker label-${labelPlacement[city.name] || 'east'}${isSelected ? ' is-selected' : ''}`} style={{ left: `${x / WIDTH * 100}%`, top: `${y / HEIGHT * 100}%` }} onClick={() => onSelectCity(city.id)} disabled={loading} aria-pressed={isSelected} aria-controls="city-map-postcard" aria-label={`Explore ${city.name}, Virginia`}><span className="city-map-pin" aria-hidden="true" /><span className="city-map-marker-name">{city.name}</span></button>;
          })}</div>
        </div>
      </div>
      <div id="city-map-postcard" className="city-map-postcard" aria-live="polite" aria-atomic="true">
        {message ? <div className="city-map-notice" role="alert"><h2>The map is waiting.</h2><p>{message}</p>{onRetry && <button className="city-map-retry" onClick={onRetry}>Try again</button>}</div> : loading && !cities.length ? <div className="city-map-notice" role="status"><h2>Unfolding the map…</h2><p>Finding your neighborhoods.</p></div> : selectedCity ? <><p className="city-map-postmark">GREETINGS FROM</p><h2>{selectedCity.name}<span>, VA</span></h2><p className="city-map-description">{selectedCity.description}</p><div className="city-map-properties">{selectedCity.properties?.length ? selectedCity.properties.map((property) => <button className="city-map-building" key={property.id} onClick={() => onOpenProperty(property.id)} disabled={loading}><HouseSketch /><span><strong>{property.name}</strong><small>{property.address}</small><em>Open this building <span aria-hidden="true">→</span></em></span></button>) : <p className="city-map-no-buildings">There are no buildings here yet. Choose another city.</p>}</div></> : <div className="city-map-notice"><h2>A place to begin.</h2><p>No cities are available yet.</p>{onRetry && <button className="city-map-retry" onClick={onRetry}>Refresh the map</button>}</div>}
      </div>
      <p className="city-map-handnote" aria-hidden="true">Your next stop<br />is up to you.</p>
    </div>
    <nav className="city-map-city-list" aria-label="Choose a Virginia city"><span>Visit: </span>{cities.map((city, index) => <React.Fragment key={city.id}>{index > 0 && <span className="city-map-separator" aria-hidden="true"> · </span>}<button onClick={() => onSelectCity(city.id)} aria-current={city.id === selectedCity?.id ? 'true' : undefined} disabled={loading}>{city.name}</button></React.Fragment>)}</nav>
    <p className="city-map-credit">Real cities, fictional buildings. Illustrated terrain; geographically placed city markers. <a href={virginiaMap.sourceUrl} target="_blank" rel="noreferrer">Boundary: U.S. Census Bureau.</a></p>
  </section>;
}
