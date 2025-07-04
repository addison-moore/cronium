import { seedEvents } from './seed-events';
import { seedWorkflows } from './seed-workflows';

/**
 * This script runs all seed scripts in sequence
 */
async function seedAll() {
  try {
    console.log('Starting all seed scripts...');
    
    // First, seed events/scripts
    console.log('\n------ SEEDING EVENTS ------\n');
    await seedEvents();
    
    // Then, seed workflows that use those events
    console.log('\n------ SEEDING WORKFLOWS ------\n');
    await seedWorkflows();
    
    console.log('\nAll seed scripts completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error running seed scripts:', error);
    process.exit(1);
  }
}

// Run the function
seedAll();