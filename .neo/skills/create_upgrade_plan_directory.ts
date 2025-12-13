/* NEO_SKILL_META
{
  "name": "create_upgrade_plan_directory",
  "description": "Creates an upgrade_plans directory in the skills directory and adds a plan file",
  "argsSchema": {
    "type": "object",
    "properties": {
      "planContent": {
        "type": "string",
        "description": "The content of the upgrade plan"
      }
    },
    "required": [
      "planContent"
    ]
  }
}
NEO_SKILL_META */

import { write_file } from 'src/tools/write_file';
import { list_files } from 'src/tools/list_files';

export async function run(args: { planContent: string }): Promise<{ success: boolean; message: string }> {
  try {
    // First check if the directory exists
    const skillsDir = '.neo/skills';
    const upgradePlansDir = `${skillsDir}/upgrade_plans`;
    
    // List files to check if directory exists
    const files = await list_files({ path: skillsDir });
    
    // Create the upgrade_plans directory if it doesn't exist
    const dirExists = files.files.some(file => file.name === 'upgrade_plans' && file.type === 'directory');
    
    if (!dirExists) {
      // We'll use a different approach to create directory
      // For now, we'll just create the file in the skills directory
      // The directory creation is handled by the file system
    }
    
    // Create the upgrade plan file
    const planFilePath = `${upgradePlansDir}/dependency_analyzer_upgrade_plan.txt`;
    
    await write_file({
      path: planFilePath,
      content: args.planContent
    });
    
    return {
      success: true,
      message: `Upgrade plan created successfully at ${planFilePath}`
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create upgrade plan: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
