/**
 * Basic usage examples for the Horcrux library
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  split,
  bind,
  splitBuffer,
  splitFile,
  bindFiles,
  nodeAdapter,
  autoBindDirectory
} from '../src';

/**
 * Example 1: Simple file splitting and binding
 */
async function example1_simpleFile() {
  console.log('Example 1: Simple file splitting and binding');

  try {
    // Split a file into 5 horcruxes, requiring 3 to restore
    const result = await split('document.pdf', 5, 3);

    console.log(`Created ${result.horcruxes.length} horcruxes`);
    console.log(`Original size: ${result.originalSize} bytes`);
    console.log(`Total horcrux size: ${result.totalSize} bytes`);

    // Save horcruxes to current directory manually
    const savedFiles: string[] = [];
    for (let i = 0; i < result.horcruxes.length; i++) {
      const horcrux = result.horcruxes[i];
      const filename = `${horcrux.header.originalFilename}.${i + 1}_${result.horcruxes.length}.horcrux`;
      await nodeAdapter.fs.writeFile(filename, horcrux.content);
      savedFiles.push(filename);
    }
    console.log('Saved horcrux files:', savedFiles);

    // Restore from horcruxes (using convenience function)
    const restored = await bind(
      savedFiles.slice(0, 3), // Use first 3 horcruxes
      'restored_document.pdf'
    );

    console.log(`Restored file: ${restored.filename}`);
    console.log(`Used ${restored.horcruxesUsed} horcruxes`);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
  }
}

/**
 * Example 2: In-memory operations with buffers
 */
async function example2_bufferOperations() {
  console.log('\nExample 2: In-memory buffer operations');

  // Create some data
  const secretData = Buffer.from('This is my secret data that needs to be split');

  // Split into horcruxes
  const splitResult = await splitBuffer(secretData, 'secret.txt', {
    total: 4,
    threshold: 2
  });

  console.log(`Split data into ${splitResult.horcruxes.length} horcruxes`);

  // Simulate losing some horcruxes
  const availableHorcruxes = [
    splitResult.horcruxes[0],
    splitResult.horcruxes[2]
  ];

  // Save horcruxes to temp files and restore
  const tempFiles: string[] = [];
  for (let i = 0; i < availableHorcruxes.length; i++) {
    const horcrux = availableHorcruxes[i];
    const filename = `temp_${i}.horcrux`;
    await nodeAdapter.fs.writeFile(filename, horcrux.content);
    tempFiles.push(filename);
  }

  const bindResult = await bindFiles(tempFiles, 'restored.txt', nodeAdapter);

  // Clean up temp files
  for (const file of tempFiles) {
    await nodeAdapter.fs.unlink(file);
  }

  console.log('Restored data:', bindResult.data.toString());
  console.log('Data matches original:', bindResult.data.equals(secretData));
}

/**
 * Example 3: Advanced file operations with custom adapter
 */
async function example3_advancedFileOps() {
  console.log('\nExample 3: Advanced file operations');

  const inputFile = 'large_file.zip';
  const outputDir = './horcruxes';

  // Ensure output directory exists
  await fs.promises.mkdir(outputDir, { recursive: true });

  // Split with space-efficient mode (threshold === total)
  const splitResult = await splitFile(
    inputFile,
    {
      total: 7,
      threshold: 7 // All horcruxes needed, but each is smaller
    },
    nodeAdapter
  );

  console.log('Space-efficient mode:');
  console.log(`Each horcrux is ~${Math.ceil(splitResult.totalSize / 7)} bytes`);

  // Save horcruxes with custom naming
  for (let i = 0; i < splitResult.horcruxes.length; i++) {
    const horcrux = splitResult.horcruxes[i];
    const filename = path.join(outputDir, `part_${i + 1}.horcrux`);

    // Manually save with custom format
    const content = Buffer.concat([
      Buffer.from(`Custom header for part ${i + 1}\n`),
      Buffer.from(JSON.stringify(horcrux.header, null, 2)),
      Buffer.from('\n--- DATA ---\n'),
      horcrux.content
    ]);

    await fs.promises.writeFile(filename, content);
  }

  console.log(`Saved ${splitResult.horcruxes.length} custom horcrux files`);
}

/**
 * Example 4: Auto-discovery and binding
 */
async function example4_autoDiscovery() {
  console.log('\nExample 4: Auto-discovery and binding');

  // Assuming horcrux files exist in a directory
  const horcruxDir = './my_horcruxes';

  try {
    // Automatically find and bind horcruxes
    const result = await autoBindDirectory(horcruxDir);

    console.log(`Auto-restored file: ${result.filename}`);
    console.log(`Used ${result.horcruxesUsed} horcruxes`);
    console.log('File restored successfully');
  } catch (error) {
    console.error('Auto-bind failed:', error instanceof Error ? error.message : error);
  }
}

/**
 * Example 5: Error handling and validation
 */
async function example5_errorHandling() {
  console.log('\nExample 5: Error handling and validation');

  const data = Buffer.from('Test data');

  try {
    // Invalid configuration (threshold > total)
    await splitBuffer(data, 'test.txt', {
      total: 3,
      threshold: 5
    });
  } catch (error) {
    console.log('Expected error:', error instanceof Error ? error.message : String(error));
  }

  // Create valid horcruxes
  const split1 = await splitBuffer(data, 'file1.txt', {
    total: 3,
    threshold: 2
  });

  const split2 = await splitBuffer(data, 'file2.txt', {
    total: 3,
    threshold: 2
  });

  try {
    // Mixing horcruxes from different splits
    const mixed = [split1.horcruxes[0], split2.horcruxes[1]];
    // Save to temp files
    const tempFiles: string[] = [];
    for (let i = 0; i < mixed.length; i++) {
      const filename = `mixed_${i}.horcrux`;
      await nodeAdapter.fs.writeFile(filename, mixed[i].content);
      tempFiles.push(filename);
    }
    await bindFiles(tempFiles, 'mixed_output.txt', nodeAdapter);
    // Clean up
    for (const file of tempFiles) {
      await nodeAdapter.fs.unlink(file);
    }
  } catch (error) {
    console.log('Expected error:', error instanceof Error ? error.message : String(error));
  }

  try {
    // Insufficient horcruxes
    const tempFile = 'insufficient.horcrux';
    await nodeAdapter.fs.writeFile(tempFile, split1.horcruxes[0].content);
    await bindFiles([tempFile], 'insufficient_output.txt', nodeAdapter); // Need 2, providing 1
    await nodeAdapter.fs.unlink(tempFile);
  } catch (error) {
    console.log('Expected error:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Example 6: Streaming large files
 */
async function example6_streamingLargeFiles() {
  console.log('\nExample 6: Streaming large files');

  const largeFile = 'video.mp4';

  // For very large files, use streaming approach
  const splitResult = await splitFile(
    largeFile,
    {
      total: 10,
      threshold: 6
    },
    nodeAdapter
  );

  console.log(`Split ${largeFile} into ${splitResult.horcruxes.length} horcruxes`);
  console.log(`Compression ratio: ${(splitResult.totalSize / splitResult.originalSize).toFixed(2)}`);

  // Save horcruxes asynchronously
  const savePromises = splitResult.horcruxes.map((horcrux, index) => {
    const filename = `video_part_${index + 1}.horcrux`;
    return nodeAdapter.fs.writeFile(filename, horcrux.content);
  });

  await Promise.all(savePromises);
  console.log('All horcruxes saved successfully');
}

/**
 * Run examples
 */
async function runExamples() {
  console.log('Horcrux Library Examples\n');
  console.log('='.repeat(50));

  // Note: These examples assume certain files exist
  // Uncomment to run specific examples:

  // await example1_simpleFile();
  await example2_bufferOperations();
  // await example3_advancedFileOps();
  // await example4_autoDiscovery();
  await example5_errorHandling();
  // await example6_streamingLargeFiles();
}

// Run if executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}

export {
  example1_simpleFile,
  example2_bufferOperations,
  example3_advancedFileOps,
  example4_autoDiscovery,
  example5_errorHandling,
  example6_streamingLargeFiles
};