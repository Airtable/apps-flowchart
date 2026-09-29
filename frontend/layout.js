import workerize from 'workerize';
import {colorUtils} from '@airtable/blocks/ui';

import {LinkStyle, ChartOrientation, RecordShape} from './settings';

const DEBUG_OUTPUT = false; // Set to true to log layout source string to console
let worker;

const workerString = `
    // Run viz.js in a worker to avoid blocking the main thread.
    // Note: viz-js utilizes WebAssembly. Be sure to note the use of WebAssembly if you're submitting an extension to Airtable's Marketplace.
    self.importScripts('https://unpkg.com/@viz-js/viz@3.1.0/lib/viz-standalone.js');

    export function layout(source) {
        return new Promise((resolve, reject) => {
            let timeoutTimer = setTimeout(() => {
                reject(new Error('Layout generation timed out after 10 seconds'));
            }, 10000);
           
            Viz.instance().then(viz => {
                return viz.renderString(source, {
                    format: 'svg',
                    engine: 'dot',
                });
            }).then(svgString => {
                clearTimeout(timeoutTimer);
                resolve(svgString);
            }).catch(err => {
                clearTimeout(timeoutTimer);
                reject(err);
            });
        });
    }
`;

/**
 * Creates a string representation of the graph based on the passed in settings
 * Uses the viz worker to convert this string to an svg
 * See https://www.graphviz.org/documentation/ for more details.
 * @param settings
 * @returns {Promise<string>} The returned promise should resolve to an svg
 */
export function createLayout(settings) {
    if (!worker) {
        worker = workerize(workerString);
    }
    const {chartOrientation, linkStyle, recordShape, queryResult, field} = settings;
    let source = 'digraph {\n\t';
    source += 'bgcolor=transparent\n\t';
    source += 'pad=0.25\n\t';
    source += 'nodesep=0.75\n\t';

    if (chartOrientation === ChartOrientation.HORIZONTAL) {
        source += 'rankdir=LR\n\t';
    }

    switch (linkStyle) {
        case LinkStyle.STRAIGHT_LINES:
            source += 'splines=line\n\n\t';
            break;
        case LinkStyle.CURVED_LINES:
            source += 'splines=curved\n\n\t';
            break;
        case LinkStyle.RIGHT_ANGLES:
        default:
            source += 'splines=ortho\n\n\t';
            break;
    }

    source += 'node [\n\t\t';
    switch (recordShape) {
        case RecordShape.ELLIPSE:
            source += 'shape=ellipse\n\t\t';
            break;
        case RecordShape.CIRCLE:
            source += 'shape=circle\n\t\t';
            break;
        case RecordShape.DIAMOND:
            source += 'shape=diamond\n\t\t';
            break;
        case RecordShape.ROUNDED:
        case RecordShape.RECTANGLE:
        default:
            source += 'shape=rect\n\t\t';
            break;
    }
    source += `style="filled${recordShape === RecordShape.ROUNDED ? ',rounded' : ''}"\n\t\t`;
    source += 'fontname=Helvetica\n\t';
    source += ']\n\n\t';

    const nodes = [];
    const edges = [];
    for (const record of queryResult.records) {
        if (record.isDeleted) {
            continue;
        }
        const recordColor = queryResult.getRecordColor(record);
        const shouldUseLightText = record
            ? colorUtils.shouldUseLightTextOnColor(recordColor)
            : false;
        let displayText = record.name.substring(0, 50).trim().replace(/"/g, '\\"');
        if (record.name.length > 50) {
            displayText += '...';
        }
        nodes.push(
            `${record.id} [id="${record.id}" label="${displayText}"
            tooltip="${displayText}"
            fontcolor="${shouldUseLightText ? 'white' : 'black'}"
            fillcolor="${recordColor ? colorUtils.getHexForColor(recordColor) : 'white'}"]`,
        );

        const linkedRecordCellValues = record.getCellValue(field.id) || [];
        for (const linkedRecordCellValue of linkedRecordCellValues) {
            // The record might be in the cell value but not in the query result when it is deleted
            const linkedRecord = queryResult.getRecordByIdIfExists(linkedRecordCellValue.id);
            if (!linkedRecord || linkedRecord.isDeleted) {
                continue;
            }
            edges.push(
                `${record.id} -> ${linkedRecord.id} [id="${record.id}->${linkedRecord.id}"]`,
            );
        }
    }

    source += nodes.join('\n\t');
    source += '\n\n\t';
    source += edges.join('\n\t');
    source += '\n}';

    if (DEBUG_OUTPUT) {
        console.log(source);
    }
    return worker.layout(source);
}
