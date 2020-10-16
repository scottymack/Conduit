import {
  deletedSchemaById,
  setCmsError,
  setCmsSchemas,
  setSchemaDocumentsByName,
  startCmsLoading,
  stopCmsLoading,
  updateSchemaStatus,
} from '../actions';
import {
  deleteCmsSchemaRequest,
  getCmsDocumentsByNameRequest,
  getCmsSchemasRequest,
  postCmsSchemaRequest,
  putCmsSchemaRequest,
  toggleSchemaByIdRequest,
  createSchemaDocumentRequest,
  deleteSchemaDocumentRequest,
  editSchemaDocumentRequest,
} from '../../http/requests';

export const getCmsSchemas = () => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    getCmsSchemasRequest(0, 100)
      .then((res) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsSchemas(res.data));
        dispatch(setCmsError(null));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};

export const createNewSchema = (data) => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    postCmsSchemaRequest(data)
      .then(() => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError(null));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};

export const toggleSchema = (_id) => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    toggleSchemaByIdRequest(_id)
      .then((res) => {
        dispatch(stopCmsLoading());
        dispatch(updateSchemaStatus(res.data));
        dispatch(setCmsError(null));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};

export const editSchema = (_id, data) => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    putCmsSchemaRequest(_id, data)
      .then(() => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError(null));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};

export const deleteSelectedSchema = (_id) => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    deleteCmsSchemaRequest(_id)
      .then(() => {
        dispatch(stopCmsLoading());
        dispatch(deletedSchemaById(_id));
        dispatch(setCmsError(null));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};

export const getSchemaDocuments = (name) => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    getCmsDocumentsByNameRequest(name)
      .then((res) => {
        dispatch(stopCmsLoading());
        dispatch(setSchemaDocumentsByName(res.data));
        dispatch(setCmsError(null));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};

export const createSchemaDocument = (schemaName, documentData) => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    const body = {
      schemaName,
      inputDocument: {},
    };
    documentData.forEach((d) => {
      body.inputDocument = { ...body.inputDocument, [d.name]: d.value };
    });
    createSchemaDocumentRequest(schemaName, body)
      .then(() => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError(null));
        dispatch(getSchemaDocuments(schemaName));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};

export const deleteSchemaDocument = (schemaName, documentId) => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    deleteSchemaDocumentRequest(schemaName, documentId)
      .then(() => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError(null));
        dispatch(getSchemaDocuments(schemaName));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};

export const editSchemaDocument = (schemaName, documentId, documentData) => {
  return (dispatch) => {
    dispatch(startCmsLoading());
    const body = {
      schemaName,
      id: documentId,
      changedDocument: {},
    };
    documentData.forEach((d) => {
      body.changedDocument = { ...body.changedDocument, [d.name]: d.value };
    });
    editSchemaDocumentRequest(schemaName, documentId, body)
      .then(() => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError(null));
        dispatch(getSchemaDocuments(schemaName));
      })
      .catch((err) => {
        dispatch(stopCmsLoading());
        dispatch(setCmsError({ err }));
      });
  };
};