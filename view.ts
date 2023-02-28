import { TextFileView } from "obsidian";

// const { spreadsheet } = require("x-data-spreadsheet/dist/xspreadsheet.js")
import Spreadsheet from "x-spreadsheet/src/index.js";
import { spreadsheet } from "x-spreadsheet/src/index.js";

export const VIEW_TYPE_CSV = "csv-view";

export class CSVView extends TextFileView {
    getViewData() {
        return this.data;
    }

    setViewData(data: string, clear: boolean) {
        var oThis = this

        function fnSaveData(sD) {
            oThis.data = sD;
            oThis.save()
        }

        this.contentEl.empty();
        
        this.contentEl.createDiv({ cls: "x-spreadsheet-demo" });
        // console.log(Spreadsheet, spreadsheet)

        
        const oO: any = {
            mode: 'edit', // edit | read
            showToolbar: true,
            showGrid: true,
            showContextmenu: true,
            showBottomBar: false,
            view: {
                height: () => document.querySelector(".view-content")?.clientHeight as number - 30,
                width: () => document.querySelector(".view-content")?.clientWidth as number - 10,
            },
            row: {
                len: 100,
                height: 25,
            },
            col: {
                len: 26,
                width: 100,
                indexWidth: 60,
                minWidth: 60,
            },
            style: {
                bgcolor: '#ffffff',
                align: 'left',
                valign: 'middle',
                textwrap: false,
                strike: false,
                underline: false,
                color: '#0a0a0a',
                font: {
                    name: 'Helvetica',
                    size: 10,
                    bold: false,
                    italic: false,
                },
            },
        }

        let _rows: any = data.split("\n")
        _rows = _rows.map((sI) => sI.split(",")
            .map((sJ) => sJ
                .replace(/^"/, '')
                .replace(/"$/, '')
                .replace(/\\"/, '"')
            ))
        var rows: any = {};
        for (var iI in _rows) {
            rows[iI] = { cells: {} }
            for (var iJ in _rows[iI]) { 
                rows[iI]['cells'][iJ] = { text: _rows[iI][iJ] }
            }
        }
        const s = spreadsheet(".x-spreadsheet-demo", oO)
            .loadData({ rows }) // load data
            .change((data: any) => {
                console.log(data)
                var _data = ""
                for (var iI in data.rows) {
                    var aRow: any[] = []
                    for (var iJ=0;iJ<30;iJ++) { 
                        // data.rows[iI].cells
                        var sS: any = ""
                        if (data.rows[iI].cells && data.rows[iI].cells[iJ] && data.rows[iI].cells[iJ].text) 
                            sS = data.rows[iI].cells[iJ].text
                        else
                            sS = ""
                        if (!sS) sS = ""
                        sS = sS.replace('"', '\\"')
                        aRow.push('"'+sS+'"')
                    }
                    _data += aRow.join(',')+"\n"
                }
                fnSaveData(_data)
            });

        console.log(rows)
    }

    clear() {
        this.data = "";
    }

    getViewType() {
        return VIEW_TYPE_CSV;
    }
}