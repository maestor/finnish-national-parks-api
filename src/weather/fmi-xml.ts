import { SaxesParser } from 'saxes';

export type Point = { lat: number; lon: number };
export type Station = Point & { id: string; name: string };
type Row = Point & { time: number; values: Map<string, number> };
export type Coverage = { stations: Station[]; rows: Row[]; modelRunTime?: number };

const WFS = 'http://www.opengis.net/wfs/2.0';
const GML = 'http://www.opengis.net/gml/3.2';
const GMLCOV = 'http://www.opengis.net/gmlcov/1.0';
const SWE = 'http://www.opengis.net/swe/2.0';
const OM = 'http://www.opengis.net/om/2.0';
const TARGET = 'http://xml.fmi.fi/namespace/om/atmosphericfeatures/1.1';
const XLINK = 'http://www.w3.org/1999/xlink';

type Element = {
  namespace: string;
  name: string;
  text: string;
  attributes: Record<string, string>;
  children: Element[];
};

const readDocument = (xml: string) => {
  const document: Element = { namespace: '', name: '', text: '', attributes: {}, children: [] };
  const stack = [document];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw new Error('Unexpected FMI document type');
  });
  parser.on('opentag', (tag) => {
    const node: Element = {
      namespace: tag.uri,
      name: tag.local,
      text: '',
      attributes: Object.fromEntries(
        Object.values(tag.attributes).map((attribute) => [
          `${attribute.uri} ${attribute.local}`,
          attribute.value
        ])
      ),
      children: []
    };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  const appendText = (content: string) => {
    stack.at(-1)!.text += content;
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(xml).close();
  const root = document.children[0];
  if (root?.namespace !== WFS || root.name !== 'FeatureCollection') {
    throw new Error('FMI did not return a feature collection');
  }
  return root;
};

const descendants = (node: Element, namespace: string, name: string): Element[] =>
  node.children.flatMap((child) =>
    child.namespace === namespace && child.name === name
      ? [child]
      : descendants(child, namespace, name)
  );

const words = (node: Element | undefined) => node?.text.trim().match(/\S+/g) ?? [];

const pointFrom = (parts: string[]) => {
  const [lat, lon] = parts.map(Number);
  return lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon }
    : undefined;
};

export const pointKey = ({ lat, lon }: Point) => `${lat},${lon}`;

const readStations = (member: Element) => {
  const points = new Map(
    descendants(member, GML, 'Point').map((point) => [
      `#${point.attributes[`${GML} id`]}`,
      pointFrom(words(descendants(point, GML, 'pos')[0]))
    ])
  );

  return descendants(member, TARGET, 'Location').flatMap((location) => {
    const id = descendants(location, GML, 'identifier')
      .find((node) => node.attributes[' codeSpace']?.endsWith('/fmisid'))
      ?.text.trim();
    const name = descendants(location, GML, 'name')
      .find((node) => node.attributes[' codeSpace']?.endsWith('/name'))
      ?.text.trim();
    const ref = descendants(location, TARGET, 'representativePoint')[0]?.attributes[
      `${XLINK} href`
    ];
    const point = ref && points.get(ref);
    return id && name && point ? [{ ...point, id, name }] : [];
  });
};

const readRows = (coverage: Element): Row[] => {
  const fields = descendants(coverage, SWE, 'field').map((field) => field.attributes[' name']);
  const positions = words(descendants(coverage, GMLCOV, 'positions')[0]);
  const tuples = words(descendants(coverage, GML, 'doubleOrNilReasonTupleList')[0]);

  if (
    positions.length % 3 !== 0 ||
    tuples.length !== (positions.length / 3) * fields.length ||
    (positions.length > 0 && fields.length === 0)
  ) {
    throw new Error('FMI positions and values do not match');
  }

  const rows: Row[] = [];
  for (let index = 0; index < positions.length / 3; index++) {
    const offset = index * 3;
    const point = pointFrom(positions.slice(offset, offset + 2));
    const time = Number(positions[offset + 2]) * 1000;
    if (!point || !Number.isFinite(new Date(time).getTime())) continue;

    const values = new Map<string, number>();
    fields.forEach((field, column) => {
      const value = Number(tuples[index * fields.length + column]);
      if (field && Number.isFinite(value)) values.set(field.toLowerCase(), value);
    });
    if (values.size > 0) rows.push({ ...point, time, values });
  }
  return rows;
};

export const parseFmiCoverage = (xml: string): Coverage[] =>
  descendants(readDocument(xml), WFS, 'member').flatMap((member) => {
    const stations = readStations(member);
    const analysisTime = descendants(member, OM, 'NamedValue').find((node) =>
      descendants(node, OM, 'name').some((name) =>
        name.attributes[`${XLINK} href`]?.endsWith('/harmonie_scandinavia_surface')
      )
    );
    const runTime = analysisTime && descendants(analysisTime, GML, 'timePosition')[0]?.text.trim();
    const modelRunTime = runTime === undefined ? undefined : Date.parse(runTime);
    return descendants(member, GMLCOV, 'MultiPointCoverage').map((coverage) => ({
      stations,
      rows: readRows(coverage),
      ...(modelRunTime !== undefined && Number.isFinite(modelRunTime) ? { modelRunTime } : {})
    }));
  });
