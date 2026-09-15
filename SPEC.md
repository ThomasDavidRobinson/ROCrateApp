## Goal
Create a simple HTML and JavaScript application that allows users to select a folder from their system, upload the contents to the web application, and once all required metadata is complete, package as an RO-Crate.

## Background
The Batchelor Institute working with the LDaCA requires an interface that allows their research teams to package language data and materials. The interface should be user friendly and intuitive, and follow a11y standards where practicable.

## Functional Requirements
The user should be able to use their system's file browser to select a folder, all PDFs within that folder should be uploaded to the application.
All available metadata should be extracted, displayed and made available for the user to edit.
All metadata necessary for the RO-Crate 1.3 standard must be marked as required fields and the ro-crate-metadata.json file not generated until they are completed.
Once an RO-Crate has been generated, the user may save the crate to their device. This will save new versions of the files to a new, user-specified directory.

## Tech Stack & Dependencies
Use JavaScript and HTML only
pdf-lib should be used for all pdf related actions
ro-crate should be used for RO-crate validation and generation tasks
use other libraries at a minimum.

### Structure
The project should separate the code by functionality, PDF functions should be constrained to one file, RO-Crate functions in another file. 

### Testing 

## Acceptance criteria
- [ ] All PDF metadata is extracted and displayed clearly.
- [ ] In edit/not in edit state of metadata fields is displayed clearly.
- [ ] An RO-Crate within specification is created in the target directory.
- [ ] All edits made by the user are reflected in the RO-Crate.
- [ ] The original files are not mutated by the application.


## Failure states
- All errors should be clear and instructive for all levels of user.

## Out of scope
- No backend or database is necessary. 