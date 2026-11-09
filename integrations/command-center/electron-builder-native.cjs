// Explicit candidate packaging configuration; the normal host build stays unchanged.
const path=require('node:path');
const base=require('../../../command-center/electron-builder.cjs');
const root=path.resolve(__dirname,'../..');
const binary=process.platform==='win32'?'.exe':'';
module.exports={...base,directories:{...base.directories,output:path.join(root,'artifacts/command-center-package')},artifactName:'Command-Center-Native-Candidate-${version}-${arch}.${ext}',extraResources:[...(base.extraResources||[]),
 {from:path.join(root,'target/release','canvas-sidekick'+binary),to:'native-sidekick/canvas-sidekick'+binary},
 {from:path.join(root,'target/release','canvas-sidekick-auth'+binary),to:'native-sidekick/canvas-sidekick-auth'+binary},
 {from:path.join(root,'tools/legacy-export.cjs'),to:'native-sidekick/migration/legacy-export.cjs'},
 {from:path.join(root,'artifacts/packages/notices'),to:'native-sidekick/licenses'}
]};
